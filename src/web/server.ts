import crypto from "node:crypto";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { AudienceService } from "../application/audience-service.js";
import { CampaignService } from "../application/campaign-service.js";
import {
  AppError,
  PlatformService,
  type SessionContext,
} from "../application/platform-service.js";
import { TemplateService } from "../application/template-service.js";
import { ReportService } from "../application/report-service.js";
import { PROJECT_ROOT } from "../config.js";
import {
  LOCAL_RUNTIME_LIMITS,
  type DeploymentMode,
  type RuntimeLimits,
} from "../domain/saas.js";
import { classifyTrackingRequest, clientFingerprintHash } from "../domain/tracking.js";
import { CampaignStore } from "../infrastructure/campaign-store.js";
import { ContentStore } from "../infrastructure/content-store.js";
import { MailTransport } from "../infrastructure/mail-transport.js";
import { PlatformStore } from "../infrastructure/platform-store.js";
import { ReportStore } from "../infrastructure/report-store.js";
import { SecretVault } from "../infrastructure/secret-vault.js";
import { SpreadsheetRuntime } from "../infrastructure/spreadsheet-runtime.js";
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  expiredSessionCookies,
  parseCookies,
  sessionCookies,
} from "./cookies.js";

export interface CreateAppOptions {
  deploymentMode?: DeploymentMode;
  tenantId?: string;
  tenantSlug?: string;
  dataRegion?: string;
  tenantConfigDigest?: string;
  limits?: RuntimeLimits;
  databasePath: string;
  allowedAdminHosts?: string[];
  allowedTrackingHosts?: string[];
  allowedTrackingOrigins?: string[];
  secureCookies?: boolean;
  bootstrapToken?: string;
  sessionTtlMs?: number;
  logger?: boolean;
  pickupDirectory?: string;
  reportDirectory?: string;
  secretVaultPath?: string;
  masterKey?: string;
  workerEnabled?: boolean;
  workerIntervalMs?: number;
}

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function hostnameFromHeader(value: string): string {
  try {
    return new URL(`http://${value}`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return "";
  }
}

function requireJson(request: FastifyRequest): void {
  const contentType = request.headers["content-type"]?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    throw new AppError(415, "JSON_REQUIRED", "此 API 只接受 application/json。");
  }
}

function tokenFromHeader(request: FastifyRequest): string | null {
  const value = request.headers["x-csrf-token"];
  return typeof value === "string" ? value : null;
}

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function boundedQueryText(value: unknown, fallback: string, maximum: number): string {
  return typeof value === "string" && value.trim()
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maximum)
    : fallback;
}

function isPublicTrackingPath(value: string): boolean {
  const pathname = value.split("?", 1)[0] ?? "";
  return pathname.startsWith("/t/") || pathname.startsWith("/training/");
}

export function redactRequestUrl(value: string): string {
  const pathname = value.split("?", 1)[0] ?? "/";
  return pathname
    .replace(/^\/t\/(o|c)\/[^/]+(?:\.gif)?$/i, "/t/$1/[token]")
    .replace(/^\/t\/a\/[^/]+\/[^/]+$/i, "/t/a/[token]/[attachment]")
    .replace(/^\/training\/[^/]+(\/ack)?$/i, "/training/[token]$1");
}

function bootstrapTokenMatches(configured: string | undefined, supplied: unknown): boolean {
  if (!configured || typeof supplied !== "string" || !supplied) return false;
  const expected = crypto.createHash("sha256").update(configured).digest();
  const actual = crypto.createHash("sha256").update(supplied).digest();
  return crypto.timingSafeEqual(expected, actual);
}

class LoginThrottle {
  private readonly attempts = new Map<string, { count: number; windowStartedAt: number; blockedUntil: number }>();
  private readonly windowMs = 15 * 60_000;
  private readonly blockMs = 15 * 60_000;
  private readonly maximumAttempts = 5;

  assertAllowed(ip: string, username: string, now = Date.now()): void {
    this.prune(now);
    for (const key of this.keys(ip, username)) {
      if ((this.attempts.get(key)?.blockedUntil ?? 0) > now) {
        throw new AppError(429, "LOGIN_THROTTLED", "登入嘗試過多，請稍後再試。");
      }
    }
  }

  recordFailure(ip: string, username: string, now = Date.now()): void {
    for (const key of this.keys(ip, username)) {
      const current = this.attempts.get(key);
      const next = !current || now - current.windowStartedAt >= this.windowMs
        ? { count: 1, windowStartedAt: now, blockedUntil: 0 }
        : { ...current, count: current.count + 1 };
      if (next.count >= this.maximumAttempts) next.blockedUntil = now + this.blockMs;
      this.attempts.set(key, next);
    }
    while (this.attempts.size > 5_000) this.attempts.delete(this.attempts.keys().next().value as string);
  }

  recordSuccess(ip: string, username: string): void {
    for (const key of this.keys(ip, username)) this.attempts.delete(key);
  }

  private keys(ip: string, username: string): string[] {
    return [`ip:${ip}`, `user:${username.toLowerCase()}`];
  }

  private prune(now: number): void {
    for (const [key, value] of this.attempts) {
      if (value.blockedUntil <= now && now - value.windowStartedAt >= this.windowMs) this.attempts.delete(key);
    }
  }
}

export async function createApp(options: CreateAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger
      ? {
          serializers: {
            req: (request: { method?: unknown; url?: unknown; headers?: { host?: unknown } }) => ({
              method: String(request.method ?? ""),
              url: redactRequestUrl(String(request.url ?? "/")),
              host: String(request.headers?.host ?? ""),
            }),
          },
        }
      : false,
    bodyLimit: 512 * 1024,
  });
  const store = new PlatformStore(options.databasePath);
  const contentStore = new ContentStore(store.database);
  const campaignStore = new CampaignStore(store.database);
  const reportStore = new ReportStore(store.database);
  const limits = options.limits ?? LOCAL_RUNTIME_LIMITS;
  const sessionTtlMs = options.sessionTtlMs ?? 8 * 60 * 60 * 1000;
  const service = new PlatformService(store, sessionTtlMs);
  const audienceService = new AudienceService(contentStore, () => service.getSettings());
  const templateService = new TemplateService(contentStore);
  const localDataDirectory = path.dirname(options.databasePath === ":memory:" ? path.join(PROJECT_ROOT, ".local-data", "test.sqlite") : options.databasePath);
  const pickupDirectory = options.pickupDirectory ?? path.join(localDataDirectory, "pickup");
  const reportDirectory = options.reportDirectory ?? path.join(localDataDirectory, "reports");
  const secretVault = new SecretVault(
    options.secretVaultPath ?? path.join(localDataDirectory, "secrets.vault.json"),
    options.masterKey,
  );
  const mailTransport = new MailTransport(pickupDirectory, secretVault);
  const campaignService = new CampaignService(
    campaignStore,
    store,
    () => service.getSettings(),
    secretVault,
    mailTransport,
    new Set(options.allowedTrackingOrigins ?? ["http://localhost", "https://localhost", "http://127.0.0.1", "https://127.0.0.1"]),
    limits,
  );
  const reportService = new ReportService(
    campaignStore,
    reportStore,
    new SpreadsheetRuntime(),
    reportDirectory,
    limits.maxReportArtifacts,
  );
  const trackingSalt = crypto.randomBytes(32);
  const secureCookies = options.secureCookies ?? false;
  const allowedHosts = new Set(
    (options.allowedAdminHosts ?? ["127.0.0.1", "localhost", "::1"]).map((host) =>
      host.toLowerCase(),
    ),
  );
  const allowedTrackingHosts = new Set(
    (options.allowedTrackingHosts ?? ["127.0.0.1", "localhost", "::1"]).map((host) => host.toLowerCase()),
  );
  const loginThrottle = new LoginThrottle();

  const mailSendingEnabled = (): boolean => {
    if (service.setupRequired()) return false;
    const senderDomains = new Set(service.getSettings().scope.senderDomains);
    return campaignStore.listConnectors().some((connector) => {
      const senderDomain = connector.senderEmail.toLowerCase().slice(connector.senderEmail.lastIndexOf("@") + 1);
      return connector.status === "ready" && senderDomains.has(senderDomain);
    }) && !store.getDeliveryControl().emergencyStop;
  };
  const currentReadiness = () => service.getReadiness(mailSendingEnabled());

  const cookiesFor = (request: FastifyRequest): Map<string, string> =>
    parseCookies(request.headers.cookie);

  const authenticate = (
    request: FastifyRequest,
    requireCsrf = false,
    allowPasswordChangeRequired = false,
  ): SessionContext => {
    const cookies = cookiesFor(request);
    const session = service.authenticate(cookies.get(SESSION_COOKIE) ?? null);
    if (requireCsrf) {
      service.verifyCsrf(
        session,
        tokenFromHeader(request),
        cookies.get(CSRF_COOKIE) ?? null,
      );
    }
    if (session.user.mustChangePassword && !allowPasswordChangeRequired) {
      throw new AppError(403, "PASSWORD_CHANGE_REQUIRED", "首次登入或管理員重設後必須先變更密碼。");
    }
    return session;
  };

  const setSession = (
    reply: FastifyReply,
    result: { sessionToken: string; csrfToken: string; expiresAt: string },
  ): void => {
    const maxAgeSeconds = Math.max(
      1,
      Math.floor((Date.parse(result.expiresAt) - Date.now()) / 1000),
    );
    reply.header(
      "Set-Cookie",
      sessionCookies(result.sessionToken, result.csrfToken, secureCookies, maxAgeSeconds),
    );
  };

  app.addContentTypeParser(
    [
      "message/rfc822",
      "application/octet-stream",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body),
  );
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))),
  );

  app.addHook("onRequest", async (request, reply) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) reply.header(name, value);
    reply.header("Cache-Control", "no-store");

    const hostname = hostnameFromHeader(request.headers.host ?? "");
    const hostAllowlist = isPublicTrackingPath(request.url) ? allowedTrackingHosts : allowedHosts;
    if (!hostAllowlist.has(hostname)) {
      throw new AppError(400, "HOST_REJECTED", "此路徑的 Host 不在精確允許清單內。");
    }

    if (!["GET", "HEAD"].includes(request.method) && request.headers.origin) {
      let originHost = "";
      try {
        originHost = new URL(request.headers.origin).host.toLowerCase();
      } catch {
        throw new AppError(403, "ORIGIN_REJECTED", "請求來源不正確。");
      }
      if (originHost !== request.headers.host?.toLowerCase()) {
        throw new AppError(403, "ORIGIN_REJECTED", "跨來源請求已被拒絕。");
      }
    }
  });

  app.get("/api/health", async () => ({
    status: "ok",
    service: "security-awareness-platform",
    version: "0.7.0-saas-cell-foundation",
    phase: 5,
    deploymentMode: options.deploymentMode ?? "local_single_tenant",
    ...(options.tenantId ? {
      tenant: {
        id: options.tenantId,
        slug: options.tenantSlug,
        dataRegion: options.dataRegion,
        configDigest: options.tenantConfigDigest,
      },
    } : {}),
    mailSendingEnabled: mailSendingEnabled(),
    emergencyStop: store.getDeliveryControl().emergencyStop,
  }));

  app.get("/api/bootstrap", async (request) => {
    const setupRequired = service.setupRequired();
    if (setupRequired) return { setupRequired: true, authenticated: false };

    const sessionToken = cookiesFor(request).get(SESSION_COOKIE) ?? null;
    try {
      const session = service.authenticate(sessionToken);
      return {
        setupRequired: false,
        authenticated: true,
        user: session.user,
        passwordChangeRequired: session.user.mustChangePassword,
        settings: service.settingsFor(session.user),
        readiness: currentReadiness(),
      };
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 401) {
        return { setupRequired: false, authenticated: false };
      }
      throw error;
    }
  });

  app.post("/api/setup", async (request, reply) => {
    requireJson(request);
    if (!options.bootstrapToken) {
      throw new AppError(503, "BOOTSTRAP_TOKEN_REQUIRED", "首次初始化尚未設定一次性 SEA_BOOTSTRAP_TOKEN。");
    }
    if (!bootstrapTokenMatches(options.bootstrapToken, request.headers["x-bootstrap-token"])) {
      throw new AppError(403, "BOOTSTRAP_REJECTED", "一次性初始化碼不正確。");
    }
    const result = await service.initialize(request.body);
    setSession(reply, result);
    return reply.code(201).send({
      user: result.user,
      passwordChangeRequired: false,
      settings: service.settingsFor(result.user),
      readiness: currentReadiness(),
      expiresAt: result.expiresAt,
    });
  });

  app.post("/api/auth/login", async (request, reply) => {
    requireJson(request);
    const body = request.body as { username?: unknown };
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    loginThrottle.assertAllowed(request.ip, username);
    let result;
    try {
      result = await service.login(request.body);
      loginThrottle.recordSuccess(request.ip, username);
    } catch (error) {
      if (error instanceof AppError && error.code === "INVALID_CREDENTIALS") {
        loginThrottle.recordFailure(request.ip, username);
      }
      throw error;
    }
    setSession(reply, result);
    return {
      user: result.user,
      passwordChangeRequired: result.user.mustChangePassword,
      settings: service.settingsFor(result.user),
      readiness: currentReadiness(),
      expiresAt: result.expiresAt,
    };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const session = authenticate(request, true, true);
    service.logout(session);
    reply.header("Set-Cookie", expiredSessionCookies(secureCookies));
    return reply.code(204).send();
  });

  app.get("/api/auth/session", async (request) => {
    const session = authenticate(request, false, true);
    return { user: session.user, expiresAt: session.expiresAt };
  });

  app.post("/api/auth/password", async (request, reply) => {
    requireJson(request);
    const session = authenticate(request, true, true);
    await service.changeOwnPassword(session.user, request.body);
    reply.header("Set-Cookie", expiredSessionCookies(secureCookies));
    return reply.code(204).send();
  });

  app.get("/api/settings", async (request) => {
    const session = authenticate(request);
    service.assertPermission(session.user, "view_scope_settings");
    return { settings: service.getSettings() };
  });

  app.patch("/api/settings", async (request) => {
    requireJson(request);
    const session = authenticate(request, true);
    const settings = service.updateSettings(session.user, request.body);
    return { settings, readiness: currentReadiness() };
  });

  app.get("/api/readiness", async (request) => {
    authenticate(request);
    return currentReadiness();
  });

  app.get("/api/recipient-groups", async (request) => {
    const session = authenticate(request);
    service.assertPermission(session.user, "view_audiences");
    return { groups: audienceService.listGroups() };
  });

  app.post("/api/recipient-groups", async (request, reply) => {
    requireJson(request);
    const session = authenticate(request, true);
    service.assertPermission(session.user, "manage_audiences");
    const group = audienceService.createGroup(session.user, request.body);
    return reply.code(201).send({ group });
  });

  app.get("/api/recipient-groups/:groupId", async (request) => {
    const session = authenticate(request);
    service.assertPermission(session.user, "view_audiences");
    const { groupId } = request.params as { groupId: string };
    return { group: audienceService.getGroup(groupId) };
  });

  app.post(
    "/api/recipient-groups/:groupId/import-csv",
    { bodyLimit: 2 * 1024 * 1024 },
    async (request) => {
      requireJson(request);
      const session = authenticate(request, true);
      service.assertPermission(session.user, "manage_audiences");
      const { groupId } = request.params as { groupId: string };
      return audienceService.importCsv(session.user, groupId, request.body);
    },
  );

  app.post(
    "/api/recipient-groups/:groupId/import-xlsx",
    { bodyLimit: 5 * 1024 * 1024 },
    async (request) => {
      const session = authenticate(request, true);
      service.assertPermission(session.user, "manage_audiences");
      if (!Buffer.isBuffer(request.body)) {
        throw new AppError(415, "XLSX_REQUIRED", "請以 XLSX MIME type 上傳名單工作簿。");
      }
      const { groupId } = request.params as { groupId: string };
      return audienceService.importXlsx(session.user, groupId, request.body);
    },
  );

  app.get("/api/templates", async (request) => {
    const session = authenticate(request);
    service.assertPermission(session.user, "view_templates");
    return { templates: templateService.listTemplates() };
  });

  app.post("/api/templates", { bodyLimit: 768 * 1024 }, async (request, reply) => {
    requireJson(request);
    const session = authenticate(request, true);
    service.assertPermission(session.user, "manage_templates");
    const template = templateService.createManual(session.user, request.body);
    return reply.code(201).send({ template });
  });

  app.post("/api/templates/import-eml", { bodyLimit: 10 * 1024 * 1024 }, async (request, reply) => {
    const session = authenticate(request, true);
    service.assertPermission(session.user, "manage_templates");
    if (!Buffer.isBuffer(request.body)) {
      throw new AppError(415, "EML_REQUIRED", "請以 message/rfc822 上傳 EML 檔案。");
    }
    const { fileName } = request.query as { fileName?: string };
    const template = await templateService.importEml(
      session.user,
      request.body,
      fileName?.trim() || "import.eml",
    );
    return reply.code(201).send({ template });
  });

  app.get("/api/templates/:templateId", async (request) => {
    const session = authenticate(request);
    service.assertPermission(session.user, "view_templates");
    const { templateId } = request.params as { templateId: string };
    return { template: templateService.getTemplate(templateId) };
  });

  app.post(
    "/api/templates/:templateId/versions",
    { bodyLimit: 768 * 1024 },
    async (request, reply) => {
      requireJson(request);
      const session = authenticate(request, true);
      service.assertPermission(session.user, "manage_templates");
      const { templateId } = request.params as { templateId: string };
      const template = templateService.addManualVersion(session.user, templateId, request.body);
      return reply.code(201).send({ template });
    },
  );

  app.get("/api/templates/:templateId/preview", async (request, reply) => {
    const session = authenticate(request);
    service.assertPermission(session.user, "view_templates");
    const { templateId } = request.params as { templateId: string };
    reply.header(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'",
    );
    reply.header("X-Frame-Options", "SAMEORIGIN");
    return reply.type("text/html; charset=utf-8").send(templateService.previewDocument(templateId));
  });

  app.post("/api/templates/:templateId/review-requests", async (request, reply) => {
    requireJson(request);
    const session = authenticate(request, true);
    service.assertPermission(session.user, "manage_templates");
    const { templateId } = request.params as { templateId: string };
    return reply.code(201).send({ template: templateService.submitReview(session.user, templateId, request.body) });
  });

  app.post("/api/templates/:templateId/reviews/:reviewId/decision", async (request) => {
    requireJson(request);
    const session = authenticate(request, true);
    service.assertPermission(session.user, "review_templates");
    const { templateId, reviewId } = request.params as { templateId: string; reviewId: string };
    return { template: templateService.decideReview(session.user, templateId, reviewId, request.body) };
  });

  app.get("/api/users", async (request) => {
    const session = authenticate(request);
    return { users: service.listUsers(session.user) };
  });

  app.post("/api/users", async (request, reply) => {
    requireJson(request);
    const session = authenticate(request, true);
    const user = await service.createUser(session.user, request.body);
    return reply.code(201).send({ user });
  });

  app.patch("/api/users/:userId", async (request) => {
    requireJson(request);
    const session = authenticate(request, true);
    const { userId } = request.params as { userId: string };
    return { user: service.updateUserAccess(session.user, userId, request.body) };
  });

  app.post("/api/users/:userId/reset-password", async (request, reply) => {
    requireJson(request);
    const session = authenticate(request, true);
    const { userId } = request.params as { userId: string };
    await service.resetUserPassword(session.user, userId, request.body);
    return reply.code(204).send();
  });

  app.post("/api/users/:userId/revoke-sessions", async (request) => {
    const session = authenticate(request, true);
    const { userId } = request.params as { userId: string };
    return { revoked: service.revokeUserSessions(session.user, userId) };
  });

  app.get("/api/connectors", async (request) => {
    const session = authenticate(request);
    service.assertPermission(session.user, "view_connectors");
    return {
      connectors: campaignService.listConnectors(service.hasPermission(session.user, "manage_connectors")),
      secretVaultAvailable: service.hasPermission(session.user, "manage_connectors")
        ? secretVault.isAvailable()
        : undefined,
    };
  });

  app.post("/api/connectors", async (request, reply) => {
    requireJson(request);
    const session = authenticate(request, true);
    service.assertPermission(session.user, "manage_connectors");
    const connector = await campaignService.createConnector(session.user, request.body);
    return reply.code(201).send({ connector });
  });

  app.post("/api/connectors/:connectorId/verify", async (request) => {
    requireJson(request);
    const session = authenticate(request, true);
    service.assertPermission(session.user, "manage_connectors");
    const { connectorId } = request.params as { connectorId: string };
    return { connector: await campaignService.verifyConnector(session.user, connectorId, request.body) };
  });

  app.get("/api/campaigns", async (request) => {
    const session = authenticate(request);
    service.assertPermission(session.user, "view_campaigns");
    return { campaigns: campaignService.listCampaigns() };
  });

  app.post("/api/campaigns", async (request, reply) => {
    requireJson(request);
    const session = authenticate(request, true);
    service.assertPermission(session.user, "manage_campaigns");
    const campaign = campaignService.createCampaign(session.user, request.body);
    return reply.code(201).send({ campaign });
  });

  app.get("/api/campaigns/:campaignId", async (request) => {
    const session = authenticate(request);
    service.assertPermission(session.user, "view_campaigns");
    const { campaignId } = request.params as { campaignId: string };
    return { campaign: campaignService.getCampaign(campaignId) };
  });

  app.post("/api/campaigns/:campaignId/review-requests", async (request, reply) => {
    requireJson(request);
    const session = authenticate(request, true);
    service.assertPermission(session.user, "manage_campaigns");
    const { campaignId } = request.params as { campaignId: string };
    return reply.code(201).send({ campaign: campaignService.submitReview(session.user, campaignId, request.body) });
  });

  app.post("/api/campaigns/:campaignId/reviews/:reviewId/decision", async (request) => {
    requireJson(request);
    const session = authenticate(request, true);
    service.assertPermission(session.user, "review_campaigns");
    const { campaignId, reviewId } = request.params as { campaignId: string; reviewId: string };
    return { campaign: campaignService.decideReview(session.user, campaignId, reviewId, request.body) };
  });

  app.post("/api/campaigns/:campaignId/schedule", async (request) => {
    requireJson(request);
    const session = authenticate(request, true);
    service.assertPermission(session.user, "manage_campaigns");
    const { campaignId } = request.params as { campaignId: string };
    return { campaign: campaignService.schedule(session.user, campaignId, request.body) };
  });

  app.post("/api/campaigns/:campaignId/operation", async (request) => {
    requireJson(request);
    const session = authenticate(request, true);
    service.assertPermission(session.user, "operate_delivery");
    const { campaignId } = request.params as { campaignId: string };
    const body = request.body as { operation?: unknown };
    return { campaign: campaignService.operate(session.user, campaignId, body.operation) };
  });

  app.post("/api/campaigns/:campaignId/audit-events", { bodyLimit: 4 * 1024 * 1024 }, async (request) => {
    requireJson(request);
    const session = authenticate(request, true);
    service.assertPermission(session.user, "import_evidence");
    const { campaignId } = request.params as { campaignId: string };
    return campaignService.importAuditEvents(session.user, campaignId, request.body);
  });

  app.post("/api/suppressions", async (request, reply) => {
    requireJson(request);
    const session = authenticate(request, true);
    service.assertPermission(session.user, "operate_delivery");
    campaignService.addSuppression(session.user, request.body);
    return reply.code(204).send();
  });

  app.get("/api/delivery/control", async (request) => {
    const session = authenticate(request);
    return service.getDeliveryControl(session.user);
  });

  app.put("/api/delivery/control", async (request) => {
    requireJson(request);
    const session = authenticate(request, true);
    const body = request.body as { emergencyStop?: unknown };
    return service.setEmergencyStop(session.user, body.emergencyStop);
  });

  app.post("/api/delivery/process", async (request) => {
    const session = authenticate(request, true);
    service.assertPermission(session.user, "operate_delivery");
    return campaignService.processQueue();
  });

  app.get("/api/audit/export", async (request, reply) => {
    const session = authenticate(request);
    const exported = service.exportAudit(session.user);
    reply.header("Content-Disposition", `attachment; filename="audit-${Date.now()}.json"`);
    return reply.type("application/json; charset=utf-8").send(exported);
  });

  app.post("/api/campaigns/:campaignId/reports", async (request, reply) => {
    const session = authenticate(request, true);
    service.assertPermission(session.user, "generate_reports");
    const { campaignId } = request.params as { campaignId: string };
    return reply.code(201).send(await reportService.generateCampaignReport(session.user, campaignId));
  });

  app.post(
    "/api/reports/vendor-rawdata",
    { bodyLimit: 25 * 1024 * 1024 },
    async (request, reply) => {
      const session = authenticate(request, true);
      service.assertPermission(session.user, "generate_reports");
      if (!Buffer.isBuffer(request.body)) {
        throw new AppError(415, "XLSX_REQUIRED", "請以 XLSX MIME type 上傳 rawdata 工作簿。");
      }
      const query = request.query as { fileName?: string; campaignName?: string; targetCount?: string };
      const parsedTarget = query.targetCount?.trim() ? Number(query.targetCount) : null;
      if (parsedTarget !== null && (!Number.isInteger(parsedTarget) || parsedTarget <= 0)) {
        throw new AppError(400, "INVALID_TARGET_COUNT", "targetCount 必須是大於 0 的整數。");
      }
      const sourceFileName = boundedQueryText(query.fileName, "rawdata.xlsx", 160);
      const campaignName = boundedQueryText(query.campaignName, path.basename(sourceFileName, path.extname(sourceFileName)), 120);
      return reply.code(201).send(await reportService.generateVendorReport(session.user, request.body, {
        sourceFileName,
        campaignName,
        targetCount: parsedTarget,
      }));
    },
  );

  app.get("/api/report-artifacts", async (request) => {
    const session = authenticate(request);
    service.assertPermission(session.user, "view_reports");
    return { artifacts: reportService.listArtifacts() };
  });

  app.get("/api/report-artifacts/:artifactId/download", async (request, reply) => {
    const session = authenticate(request);
    service.assertPermission(session.user, "view_reports");
    const { artifactId } = request.params as { artifactId: string };
    const { artifact, content } = await reportService.getArtifact(artifactId);
    const mime = {
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      json: "application/json; charset=utf-8",
    }[artifact.format];
    reply.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(artifact.fileName)}`);
    reply.header("X-Content-SHA256", artifact.sha256);
    return reply.type(mime).send(content);
  });

  const trackingContext = (request: FastifyRequest, eventType: "email_opened" | "link_clicked" | "attachment_opened" | "training_viewed" | "training_acknowledged") => {
    const classification = classifyTrackingRequest(eventType, request.headers);
    return {
      ...classification,
      fingerprintHash: clientFingerprintHash(
        trackingSalt,
        request.ip,
        typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : undefined,
      ),
    };
  };

  app.get("/t/o/:token", async (request, reply) => {
    const { token: value } = request.params as { token: string };
    const token = value.replace(/\.gif$/i, "");
    const context = trackingContext(request, "email_opened");
    try {
      campaignService.recordTrackingEvent({
        token,
        eventType: "email_opened",
        source: "tracking_endpoint",
        ...context,
        metadata: { classificationReason: context.reason },
      });
    } catch (error) {
      if (!(error instanceof AppError && error.statusCode === 404)) throw error;
    }
    const pixel = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
    reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
    return reply.type("image/gif").send(pixel);
  });

  app.get("/t/c/:token", async (request, reply) => {
    const { token } = request.params as { token: string };
    const context = trackingContext(request, "link_clicked");
    campaignService.recordTrackingEvent({
      token,
      eventType: "link_clicked",
      source: "tracking_endpoint",
      ...context,
      metadata: { classificationReason: context.reason },
    });
    return reply.redirect(`/training/${encodeURIComponent(token)}`);
  });

  app.get("/training/:token", async (request, reply) => {
    const { token } = request.params as { token: string };
    const context = trackingContext(request, "training_viewed");
    const event = campaignService.recordTrackingEvent({
      token,
      eventType: "training_viewed",
      source: "tracking_endpoint",
      ...context,
      metadata: { classificationReason: context.reason },
    });
    reply.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    return reply.type("text/html; charset=utf-8").send(`<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>安全意識說明</title><style>body{font-family:Arial,"Microsoft JhengHei",sans-serif;background:#eef3f0;color:#17211d;margin:0;padding:32px}.card{max-width:680px;margin:auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 12px 40px #17324d18}h1{color:#285943}.notice{background:#fff4d8;padding:14px;border-radius:8px}button{background:#285943;color:#fff;border:0;border-radius:8px;padding:12px 18px;font-weight:700}</style></head>
<body><main class="card"><p>您好，${htmlEscape(event.recipientName)}：</p><h1>這是一封經授權的內部安全意識演練郵件</h1><p class="notice">平台不會要求或保存密碼、OTP、Token、Cookie 或 Session。</p><p>請留意寄件網域、突發急迫感、外部連結與附件來源。遇到疑慮時，請使用組織既有通報流程。</p><form method="post" action="/training/${encodeURIComponent(token)}/ack"><button type="submit">我已閱讀安全提醒</button></form></main></body></html>`);
  });

  app.post("/training/:token/ack", async (request, reply) => {
    const { token } = request.params as { token: string };
    const context = trackingContext(request, "training_acknowledged");
    campaignService.recordTrackingEvent({
      token,
      eventType: "training_acknowledged",
      source: "tracking_endpoint",
      ...context,
      metadata: { classificationReason: context.reason },
    });
    reply.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
    return reply.type("text/html; charset=utf-8").send("<!doctype html><html lang=\"zh-Hant\"><head><meta charset=\"utf-8\"><title>完成</title><style>body{font-family:Arial,sans-serif;padding:40px;color:#285943}</style></head><body><h1>已完成安全提醒</h1><p>謝謝您的參與，您可以關閉此頁。</p></body></html>");
  });

  app.get("/t/a/:token/:attachmentId", async (request, reply) => {
    const { token, attachmentId } = request.params as { token: string; attachmentId: string };
    const context = trackingContext(request, "attachment_opened");
    campaignService.recordTrackingEvent({
      token,
      eventType: "attachment_opened",
      source: "controlled_attachment",
      attachmentId,
      ...context,
      metadata: { classificationReason: context.reason },
    });
    const attachment = campaignService.controlledAttachment(token, attachmentId);
    reply.header("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`);
    reply.header("Content-Security-Policy", "default-src 'none'; sandbox");
    return reply.type(attachment.mimeType).send(attachment.content);
  });

  let worker: NodeJS.Timeout | null = null;
  if (options.workerEnabled ?? true) {
    worker = setInterval(() => {
      void campaignService.processQueue().catch((error) => app.log.error(error));
    }, options.workerIntervalMs ?? 5_000);
    worker.unref();
  }

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) {
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: "找不到指定 API。" } });
    }
    return reply.code(404).type("text/plain; charset=utf-8").send("找不到指定頁面。");
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message },
      });
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode < 500
    ) {
      return reply.code(error.statusCode).send({
        error: { code: "BAD_REQUEST", message: "請求格式不正確。" },
      });
    }
    app.log.error(error);
    return reply.code(500).send({
      error: { code: "INTERNAL_ERROR", message: "伺服器處理失敗。" },
    });
  });

  await app.register(fastifyStatic, {
    root: path.join(PROJECT_ROOT, "public"),
    prefix: "/",
    index: ["index.html"],
    wildcard: false,
  });

  app.addHook("onClose", async () => {
    if (worker) clearInterval(worker);
    store.close();
  });
  return app;
}
