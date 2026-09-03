import crypto from "node:crypto";
import path from "node:path";

export type DeploymentMode = "local_single_tenant" | "saas_tenant_cell";
export type TenantLifecycleStatus = "draft" | "pending_approval" | "approved" | "active" | "suspended";

export interface RuntimeLimits {
  maxActiveCampaigns: number;
  maxRecipientsPerCampaign: number;
  maxMonthlyMessages: number;
  maxReportArtifacts: number;
  maxThrottlePerMinute: number;
}

export const LOCAL_RUNTIME_LIMITS: RuntimeLimits = {
  maxActiveCampaigns: Number.MAX_SAFE_INTEGER,
  maxRecipientsPerCampaign: 50_000,
  maxMonthlyMessages: Number.MAX_SAFE_INTEGER,
  maxReportArtifacts: 3_000,
  maxThrottlePerMinute: 600,
};

export interface SaaSTenantManifest {
  schemaVersion: 1;
  tenantId: string;
  slug: string;
  displayName: string;
  dataRegion: string;
  lifecycle: {
    status: TenantLifecycleStatus;
    requestedBy: string;
    requestedAt: string;
    approvedBy: string | null;
    approvedAt: string | null;
  };
  domains: {
    adminHost: string;
    trackingHost: string;
    recipientDomains: string[];
    senderDomains: string[];
  };
  identity: {
    provider: "oidc";
    issuer: string;
    clientId: string;
    clientSecretRef: string;
    redirectUri: string;
    roleClaim: string;
  };
  delivery: {
    provider: "smtp" | "aws_ses" | "sendgrid" | "mailgun";
    credentialRef: string;
    webhookSecretRef: string;
  };
  platformSecrets: {
    bootstrapTokenRef: string;
    masterKeyRef: string;
  };
  limits: RuntimeLimits;
  retention: {
    recipientDays: number;
    eventDays: number;
    auditDays: number;
  };
  contacts: {
    securityEmail: string;
    privacyEmail: string;
    operationsEmail: string;
  };
}

export interface SaaSTenantRegistry {
  schemaVersion: 1;
  tenants: SaaSTenantManifest[];
}

export interface TenantDeploymentPlan {
  schemaVersion: 1;
  tenantId: string;
  tenantSlug: string;
  manifestDigest: string;
  runtimeEnvironment: Record<string, string>;
  requiredSecrets: Array<{ environmentVariable: string; reference: string }>;
  identity: Pick<SaaSTenantManifest["identity"], "provider" | "issuer" | "clientId" | "redirectUri" | "roleClaim">;
  delivery: Pick<SaaSTenantManifest["delivery"], "provider">;
  limits: RuntimeLimits;
}

export class SaaSManifestValidationError extends Error {}
export class SaaSQuotaExceededError extends Error {}

const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;
const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SECRET_REFERENCE_PATTERN = /^secret:\/\/(?:aws-secrets-manager|azure-key-vault|gcp-secret-manager|vault|environment)\/[a-zA-Z0-9._/@-]+$/;

function recordFrom(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SaaSManifestValidationError(`${label} 必須是物件。`);
  }
  return value as Record<string, unknown>;
}

function assertKnownKeys(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedKeys = new Set(allowed);
  const unexpected = Object.keys(record).filter((key) => !allowedKeys.has(key));
  if (unexpected.length) {
    throw new SaaSManifestValidationError(`${label} 含未允許欄位：${unexpected.join(", ")}。`);
  }
}

function scanForEmbeddedSecrets(value: unknown, location = "manifest"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForEmbeddedSecrets(item, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bghp_[a-zA-Z0-9]{30,}\b|\bsk_live_[a-zA-Z0-9]+\b/.test(value)) {
      throw new SaaSManifestValidationError(`${location} 不得包含秘密值。`);
    }
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (
      /(?:password|private.?key|api.?key|access.?key|secret|token)/i.test(key)
      && key !== "platformSecrets"
      && !/Ref$/i.test(key)
    ) {
      throw new SaaSManifestValidationError(`${location}.${key} 不得保存秘密，只能使用 *Ref 欄位。`);
    }
    scanForEmbeddedSecrets(child, `${location}.${key}`);
  }
}

function text(value: unknown, label: string, minimum: number, maximum: number): string {
  if (typeof value !== "string") throw new SaaSManifestValidationError(`${label} 必須是字串。`);
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new SaaSManifestValidationError(`${label} 長度必須介於 ${minimum} 到 ${maximum}。`);
  }
  return normalized;
}

function identifier(value: unknown, label: string): string {
  const normalized = text(value, label, 3, 63).toLowerCase();
  if (!ID_PATTERN.test(normalized)) {
    throw new SaaSManifestValidationError(`${label} 只能使用小寫英數字與內部連字號。`);
  }
  return normalized;
}

function domain(value: unknown, label: string): string {
  const normalized = text(value, label, 4, 253).toLowerCase().replace(/\.$/, "");
  if (!DOMAIN_PATTERN.test(normalized) || normalized.includes("*")) {
    throw new SaaSManifestValidationError(`${label} 必須是精確 DNS 名稱，不接受 wildcard。`);
  }
  return normalized;
}

function domainList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.length) {
    throw new SaaSManifestValidationError(`${label} 至少需要一筆。`);
  }
  const values = value.map((item, index) => domain(item, `${label}[${index}]`));
  return [...new Set(values)];
}

function email(value: unknown, label: string): string {
  const normalized = text(value, label, 5, 254).toLowerCase();
  if (!EMAIL_PATTERN.test(normalized)) throw new SaaSManifestValidationError(`${label} 格式不正確。`);
  return normalized;
}

function timestamp(value: unknown, label: string): string {
  const normalized = text(value, label, 20, 40);
  const milliseconds = Date.parse(normalized);
  if (!Number.isFinite(milliseconds)) throw new SaaSManifestValidationError(`${label} 必須是 ISO timestamp。`);
  return new Date(milliseconds).toISOString();
}

function nullableTimestamp(value: unknown, label: string): string | null {
  return value === null ? null : timestamp(value, label);
}

function nullableEmail(value: unknown, label: string): string | null {
  return value === null ? null : email(value, label);
}

function positiveInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new SaaSManifestValidationError(`${label} 必須介於 ${minimum} 到 ${maximum}。`);
  }
  return Number(value);
}

function secretReference(value: unknown, label: string): string {
  const normalized = text(value, label, 16, 500);
  if (!SECRET_REFERENCE_PATTERN.test(normalized)) {
    throw new SaaSManifestValidationError(`${label} 必須是核准的 secret:// provider reference。`);
  }
  return normalized;
}

function httpsUrl(value: unknown, label: string, callbackOnly = false): string {
  const normalized = text(value, label, 8, 500);
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new SaaSManifestValidationError(`${label} URL 格式不正確。`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new SaaSManifestValidationError(`${label} 必須是無 credential、query 或 fragment 的 HTTPS URL。`);
  }
  if (callbackOnly && parsed.pathname !== "/api/auth/oidc/callback") {
    throw new SaaSManifestValidationError(`${label} path 必須是 /api/auth/oidc/callback。`);
  }
  return parsed.toString();
}

function limitsFrom(value: unknown): RuntimeLimits {
  const limits = recordFrom(value, "limits");
  assertKnownKeys(limits, [
    "maxActiveCampaigns",
    "maxRecipientsPerCampaign",
    "maxMonthlyMessages",
    "maxReportArtifacts",
    "maxThrottlePerMinute",
  ], "limits");
  return {
    maxActiveCampaigns: positiveInteger(limits.maxActiveCampaigns, "limits.maxActiveCampaigns", 1, 10_000),
    maxRecipientsPerCampaign: positiveInteger(limits.maxRecipientsPerCampaign, "limits.maxRecipientsPerCampaign", 1, 50_000),
    maxMonthlyMessages: positiveInteger(limits.maxMonthlyMessages, "limits.maxMonthlyMessages", 1, 10_000_000),
    maxReportArtifacts: positiveInteger(limits.maxReportArtifacts, "limits.maxReportArtifacts", 3, 100_000),
    maxThrottlePerMinute: positiveInteger(limits.maxThrottlePerMinute, "limits.maxThrottlePerMinute", 1, 600),
  };
}

export function parseSaaSTenantManifest(value: unknown): SaaSTenantManifest {
  scanForEmbeddedSecrets(value);
  const manifest = recordFrom(value, "tenant");
  assertKnownKeys(manifest, [
    "schemaVersion",
    "tenantId",
    "slug",
    "displayName",
    "dataRegion",
    "lifecycle",
    "domains",
    "identity",
    "delivery",
    "platformSecrets",
    "limits",
    "retention",
    "contacts",
  ], "tenant");
  if (manifest.schemaVersion !== 1) throw new SaaSManifestValidationError("tenant.schemaVersion 必須是 1。");

  const lifecycle = recordFrom(manifest.lifecycle, "lifecycle");
  assertKnownKeys(lifecycle, ["status", "requestedBy", "requestedAt", "approvedBy", "approvedAt"], "lifecycle");
  const statuses: TenantLifecycleStatus[] = ["draft", "pending_approval", "approved", "active", "suspended"];
  if (typeof lifecycle.status !== "string" || !statuses.includes(lifecycle.status as TenantLifecycleStatus)) {
    throw new SaaSManifestValidationError("lifecycle.status 不正確。");
  }
  const requestedBy = email(lifecycle.requestedBy, "lifecycle.requestedBy");
  const requestedAt = timestamp(lifecycle.requestedAt, "lifecycle.requestedAt");
  const approvedBy = nullableEmail(lifecycle.approvedBy, "lifecycle.approvedBy");
  const approvedAt = nullableTimestamp(lifecycle.approvedAt, "lifecycle.approvedAt");
  if (["approved", "active"].includes(lifecycle.status) && (!approvedBy || !approvedAt)) {
    throw new SaaSManifestValidationError("approved/active tenant 必須有獨立核准人與核准時間。");
  }
  if (approvedBy && approvedBy === requestedBy) {
    throw new SaaSManifestValidationError("Tenant 申請人與核准人必須不同。");
  }

  const domains = recordFrom(manifest.domains, "domains");
  assertKnownKeys(domains, ["adminHost", "trackingHost", "recipientDomains", "senderDomains"], "domains");
  const adminHost = domain(domains.adminHost, "domains.adminHost");
  const trackingHost = domain(domains.trackingHost, "domains.trackingHost");
  if (adminHost === trackingHost) throw new SaaSManifestValidationError("管理與追蹤 hostname 必須分離。");

  const identity = recordFrom(manifest.identity, "identity");
  assertKnownKeys(identity, ["provider", "issuer", "clientId", "clientSecretRef", "redirectUri", "roleClaim"], "identity");
  if (identity.provider !== "oidc") throw new SaaSManifestValidationError("SaaS identity.provider 目前只允許 oidc。");
  const redirectUri = httpsUrl(identity.redirectUri, "identity.redirectUri", true);
  if (new URL(redirectUri).hostname.toLowerCase() !== adminHost) {
    throw new SaaSManifestValidationError("OIDC redirect hostname 必須等於 tenant 管理 hostname。");
  }

  const delivery = recordFrom(manifest.delivery, "delivery");
  assertKnownKeys(delivery, ["provider", "credentialRef", "webhookSecretRef"], "delivery");
  const deliveryProviders = ["smtp", "aws_ses", "sendgrid", "mailgun"] as const;
  if (typeof delivery.provider !== "string" || !deliveryProviders.includes(delivery.provider as (typeof deliveryProviders)[number])) {
    throw new SaaSManifestValidationError("delivery.provider 不在允許清單。");
  }

  const platformSecrets = recordFrom(manifest.platformSecrets, "platformSecrets");
  assertKnownKeys(platformSecrets, ["bootstrapTokenRef", "masterKeyRef"], "platformSecrets");

  const retention = recordFrom(manifest.retention, "retention");
  assertKnownKeys(retention, ["recipientDays", "eventDays", "auditDays"], "retention");

  const contacts = recordFrom(manifest.contacts, "contacts");
  assertKnownKeys(contacts, ["securityEmail", "privacyEmail", "operationsEmail"], "contacts");

  return {
    schemaVersion: 1,
    tenantId: identifier(manifest.tenantId, "tenantId"),
    slug: identifier(manifest.slug, "slug"),
    displayName: text(manifest.displayName, "displayName", 2, 120),
    dataRegion: identifier(manifest.dataRegion, "dataRegion"),
    lifecycle: {
      status: lifecycle.status as TenantLifecycleStatus,
      requestedBy,
      requestedAt,
      approvedBy,
      approvedAt,
    },
    domains: {
      adminHost,
      trackingHost,
      recipientDomains: domainList(domains.recipientDomains, "domains.recipientDomains"),
      senderDomains: domainList(domains.senderDomains, "domains.senderDomains"),
    },
    identity: {
      provider: "oidc",
      issuer: httpsUrl(identity.issuer, "identity.issuer"),
      clientId: text(identity.clientId, "identity.clientId", 3, 200),
      clientSecretRef: secretReference(identity.clientSecretRef, "identity.clientSecretRef"),
      redirectUri,
      roleClaim: text(identity.roleClaim, "identity.roleClaim", 1, 100),
    },
    delivery: {
      provider: delivery.provider as SaaSTenantManifest["delivery"]["provider"],
      credentialRef: secretReference(delivery.credentialRef, "delivery.credentialRef"),
      webhookSecretRef: secretReference(delivery.webhookSecretRef, "delivery.webhookSecretRef"),
    },
    platformSecrets: {
      bootstrapTokenRef: secretReference(platformSecrets.bootstrapTokenRef, "platformSecrets.bootstrapTokenRef"),
      masterKeyRef: secretReference(platformSecrets.masterKeyRef, "platformSecrets.masterKeyRef"),
    },
    limits: limitsFrom(manifest.limits),
    retention: {
      recipientDays: positiveInteger(retention.recipientDays, "retention.recipientDays", 1, 3_650),
      eventDays: positiveInteger(retention.eventDays, "retention.eventDays", 1, 3_650),
      auditDays: positiveInteger(retention.auditDays, "retention.auditDays", 30, 3_650),
    },
    contacts: {
      securityEmail: email(contacts.securityEmail, "contacts.securityEmail"),
      privacyEmail: email(contacts.privacyEmail, "contacts.privacyEmail"),
      operationsEmail: email(contacts.operationsEmail, "contacts.operationsEmail"),
    },
  };
}

function registerUnique(seen: Map<string, string>, value: string, tenantId: string, label: string): void {
  const owner = seen.get(value);
  if (owner) {
    throw new SaaSManifestValidationError(`${label} ${value} 同時屬於 ${owner} 與 ${tenantId}。`);
  }
  seen.set(value, tenantId);
}

function registerDomainClaim(
  claims: Array<{ value: string; tenantId: string }>,
  value: string,
  tenantId: string,
  label: string,
): void {
  const collision = claims.find((claim) =>
    claim.tenantId !== tenantId
    && (claim.value === value || claim.value.endsWith(`.${value}`) || value.endsWith(`.${claim.value}`)),
  );
  if (collision) {
    throw new SaaSManifestValidationError(
      `${label} ${value} 與 tenant ${collision.tenantId} 的 ${collision.value} 範圍重疊。`,
    );
  }
  claims.push({ value, tenantId });
}

export function parseSaaSTenantRegistry(value: unknown): SaaSTenantRegistry {
  scanForEmbeddedSecrets(value);
  const registry = recordFrom(value, "registry");
  assertKnownKeys(registry, ["schemaVersion", "tenants"], "registry");
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.tenants) || !registry.tenants.length) {
    throw new SaaSManifestValidationError("registry.schemaVersion 必須是 1，且 tenants 不可為空。");
  }
  const tenants = registry.tenants.map(parseSaaSTenantManifest);
  const tenantIds = new Map<string, string>();
  const slugs = new Map<string, string>();
  const domainClaims: Array<{ value: string; tenantId: string }> = [];
  for (const tenant of tenants) {
    registerUnique(tenantIds, tenant.tenantId, tenant.tenantId, "tenantId");
    registerUnique(slugs, tenant.slug, tenant.tenantId, "slug");
    registerDomainClaim(domainClaims, tenant.domains.adminHost, tenant.tenantId, "admin hostname");
    registerDomainClaim(domainClaims, tenant.domains.trackingHost, tenant.tenantId, "tracking hostname");
    tenant.domains.recipientDomains.forEach((item) => registerDomainClaim(domainClaims, item, tenant.tenantId, "recipient domain"));
    tenant.domains.senderDomains.forEach((item) => registerDomainClaim(domainClaims, item, tenant.tenantId, "sender domain"));
  }
  return { schemaVersion: 1, tenants };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

export function tenantManifestDigest(manifest: SaaSTenantManifest): string {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(manifest))).digest("hex");
}

export function buildTenantDeploymentPlan(
  registry: SaaSTenantRegistry,
  tenantId: string,
  baseDataRoot: string,
): TenantDeploymentPlan {
  const tenant = registry.tenants.find((item) => item.tenantId === tenantId);
  if (!tenant) throw new SaaSManifestValidationError(`找不到 tenant ${tenantId}。`);
  if (tenant.lifecycle.status !== "approved" && tenant.lifecycle.status !== "active") {
    throw new SaaSManifestValidationError(`Tenant ${tenantId} 尚未完成獨立核准。`);
  }
  if (!path.isAbsolute(baseDataRoot)) {
    throw new SaaSManifestValidationError("SaaS data root 必須是絕對路徑。");
  }
  const root = path.resolve(baseDataRoot);
  const tenantRoot = path.resolve(root, tenant.tenantId);
  const relative = path.relative(root, tenantRoot);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new SaaSManifestValidationError("Tenant data root 無法安全隔離。");
  }
  const manifestDigest = tenantManifestDigest(tenant);
  return {
    schemaVersion: 1,
    tenantId: tenant.tenantId,
    tenantSlug: tenant.slug,
    manifestDigest,
    runtimeEnvironment: {
      SEA_DEPLOYMENT_MODE: "saas_tenant_cell",
      SEA_TENANT_ID: tenant.tenantId,
      SEA_TENANT_SLUG: tenant.slug,
      SEA_DATA_REGION: tenant.dataRegion,
      SEA_TENANT_CONFIG_DIGEST: manifestDigest,
      SEA_TENANT_DATA_ROOT: tenantRoot,
      SEA_DATABASE_PATH: path.join(tenantRoot, "database", "platform.sqlite"),
      SEA_PICKUP_DIRECTORY: path.join(tenantRoot, "pickup"),
      SEA_REPORT_DIRECTORY: path.join(tenantRoot, "reports"),
      SEA_SECRET_VAULT_PATH: path.join(tenantRoot, "vault", "secrets.vault.json"),
      SEA_BIND_HOST: "0.0.0.0",
      SEA_ALLOW_REMOTE_ADMIN: "true",
      SEA_ADMIN_HOSTNAMES: tenant.domains.adminHost,
      SEA_TRACKING_ORIGINS: `https://${tenant.domains.trackingHost}`,
      SEA_SECURE_COOKIES: "true",
      SEA_REMOTE_HTTPS_PROXY: "true",
      SEA_WORKER_ENABLED: "true",
      SEA_MAX_ACTIVE_CAMPAIGNS: String(tenant.limits.maxActiveCampaigns),
      SEA_MAX_RECIPIENTS_PER_CAMPAIGN: String(tenant.limits.maxRecipientsPerCampaign),
      SEA_MAX_MONTHLY_MESSAGES: String(tenant.limits.maxMonthlyMessages),
      SEA_MAX_REPORT_ARTIFACTS: String(tenant.limits.maxReportArtifacts),
      SEA_MAX_THROTTLE_PER_MINUTE: String(tenant.limits.maxThrottlePerMinute),
    },
    requiredSecrets: [
      { environmentVariable: "SEA_BOOTSTRAP_TOKEN", reference: tenant.platformSecrets.bootstrapTokenRef },
      { environmentVariable: "SEA_MASTER_KEY", reference: tenant.platformSecrets.masterKeyRef },
      { environmentVariable: "SEA_OIDC_CLIENT_SECRET", reference: tenant.identity.clientSecretRef },
      { environmentVariable: "SEA_DELIVERY_CREDENTIAL", reference: tenant.delivery.credentialRef },
      { environmentVariable: "SEA_DELIVERY_WEBHOOK_SECRET", reference: tenant.delivery.webhookSecretRef },
    ],
    identity: {
      provider: tenant.identity.provider,
      issuer: tenant.identity.issuer,
      clientId: tenant.identity.clientId,
      redirectUri: tenant.identity.redirectUri,
      roleClaim: tenant.identity.roleClaim,
    },
    delivery: { provider: tenant.delivery.provider },
    limits: tenant.limits,
  };
}

export function assertQuotaAvailable(label: string, current: number, requested: number, maximum: number): void {
  if (current < 0 || requested < 0 || current + requested > maximum) {
    throw new SaaSQuotaExceededError(`${label} 配額為 ${maximum}，目前 ${current}，本次要求 ${requested}。`);
  }
}
