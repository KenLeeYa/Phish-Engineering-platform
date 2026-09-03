import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOCAL_RUNTIME_LIMITS,
  type DeploymentMode,
  type RuntimeLimits,
} from "./domain/saas.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface RuntimeConfig {
  deploymentMode: DeploymentMode;
  tenantId: string | undefined;
  tenantSlug: string | undefined;
  dataRegion: string | undefined;
  tenantDataRoot: string | undefined;
  tenantConfigDigest: string | undefined;
  limits: RuntimeLimits;
  host: string;
  port: number;
  databasePath: string;
  allowedAdminHosts: string[];
  allowedTrackingHosts: string[];
  allowedTrackingOrigins: string[];
  secureCookies: boolean;
  bootstrapToken: string | undefined;
  sessionTtlMs: number;
  pickupDirectory: string;
  reportDirectory: string;
  secretVaultPath: string;
  masterKey: string | undefined;
  workerEnabled: boolean;
  workerIntervalMs: number;
}

const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("SEA_PORT 必須是 1 到 65535 的整數。");
  }
  return port;
}

function parseDeploymentMode(value: string | undefined): DeploymentMode {
  const mode = value?.trim() || "local_single_tenant";
  if (mode !== "local_single_tenant" && mode !== "saas_tenant_cell") {
    throw new Error("SEA_DEPLOYMENT_MODE 只允許 local_single_tenant 或 saas_tenant_cell。");
  }
  return mode;
}

function requiredIdentifier(value: string | undefined, variable: string): string {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!TENANT_ID_PATTERN.test(normalized)) {
    throw new Error(`${variable} 必須是 3 到 63 字元的小寫英數字與內部連字號。`);
  }
  return normalized;
}

function requiredValue(value: string | undefined, variable: string): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new Error(`SaaS tenant cell 必須設定 ${variable}。`);
  return normalized;
}

function runtimeSecret(environment: NodeJS.ProcessEnv, variable: string): string | undefined {
  const direct = environment[variable]?.trim();
  const fileVariable = `${variable}_FILE`;
  const filePath = environment[fileVariable]?.trim();
  if (direct && filePath) throw new Error(`${variable} 與 ${fileVariable} 不可同時設定。`);
  if (!filePath) return direct || undefined;
  if (!path.isAbsolute(filePath)) throw new Error(`${fileVariable} 必須是絕對路徑。`);
  try {
    const value = fs.readFileSync(filePath, "utf8").trim();
    if (!value) throw new Error("秘密檔案是空的。");
    return value;
  } catch (error) {
    throw new Error(`${fileVariable} 無法讀取：${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseLimit(
  value: string | undefined,
  variable: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${variable} 必須是 ${minimum} 到 ${maximum} 的整數。`);
  }
  return parsed;
}

function assertPathInside(root: string, candidate: string, variable: string): string {
  if (!path.isAbsolute(candidate)) throw new Error(`${variable} 必須是絕對路徑。`);
  const resolved = path.resolve(candidate);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${variable} 必須位於 SEA_TENANT_DATA_ROOT 內，且不可等於根目錄。`);
  }
  return resolved;
}

function normalizedHosts(value: string | undefined, bindHost: string): string[] {
  const configured = value
    ?.split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (configured?.length) return [...new Set(configured)];
  if (bindHost === "127.0.0.1" || bindHost === "localhost" || bindHost === "::1") {
    return ["127.0.0.1", "localhost", "::1"];
  }
  return [bindHost.toLowerCase()];
}

function normalizedTrackingOrigins(value: string | undefined, isLoopback: boolean, port: number): string[] {
  const configured = value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
  const inputs = configured.length
    ? configured
    : isLoopback
      ? [`http://127.0.0.1:${port}`, `http://localhost:${port}`]
      : [];
  return [...new Set(inputs.map((input) => {
    const url = new URL(input);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("SEA_TRACKING_ORIGINS 每一筆只能包含 scheme、主機與連接埠。");
    }
    const originLoopback = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
    if (!originLoopback && url.protocol !== "https:") {
      throw new Error("非本機追蹤 Origin 必須使用 HTTPS。");
    }
    return url.origin;
  }))];
}

export function readRuntimeConfig(environment: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const deploymentMode = parseDeploymentMode(environment.SEA_DEPLOYMENT_MODE);
  const isSaaS = deploymentMode === "saas_tenant_cell";
  const host = environment.SEA_BIND_HOST?.trim() || "127.0.0.1";
  const isLoopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
  const requiresProtectedIngress = !isLoopback || isSaaS;
  const port = parsePort(environment.SEA_PORT ?? "4280");
  const bootstrapToken = runtimeSecret(environment, "SEA_BOOTSTRAP_TOKEN");
  const masterKey = runtimeSecret(environment, "SEA_MASTER_KEY");
  if (requiresProtectedIngress && environment.SEA_ALLOW_REMOTE_ADMIN !== "true") {
    throw new Error(
      "管理介面預設只允許 loopback；遠端或 SaaS 模式必須明確設定 SEA_ALLOW_REMOTE_ADMIN=true 與 SEA_ADMIN_HOSTNAMES。",
    );
  }
  if (requiresProtectedIngress && !environment.SEA_ADMIN_HOSTNAMES?.trim()) {
    throw new Error("遠端或 SaaS 模式必須明確設定 SEA_ADMIN_HOSTNAMES，不接受未限定的 Host。");
  }
  if (requiresProtectedIngress && environment.SEA_SECURE_COOKIES !== "true") {
    throw new Error("遠端或 SaaS 模式必須設定 SEA_SECURE_COOKIES=true。");
  }
  if (requiresProtectedIngress && environment.SEA_REMOTE_HTTPS_PROXY !== "true") {
    throw new Error("遠端或 SaaS 模式必須設定 SEA_REMOTE_HTTPS_PROXY=true，確認由 HTTPS reverse proxy 保護。");
  }
  if (requiresProtectedIngress && !environment.SEA_TRACKING_ORIGINS?.trim()) {
    throw new Error("遠端或 SaaS 模式必須設定客戶自有的精確 SEA_TRACKING_ORIGINS。");
  }

  const allowedAdminHosts = normalizedHosts(environment.SEA_ADMIN_HOSTNAMES, host);
  const allowedTrackingOrigins = normalizedTrackingOrigins(environment.SEA_TRACKING_ORIGINS, isLoopback, port);
  const allowedTrackingHosts = [...new Set(allowedTrackingOrigins.map((origin) => new URL(origin).hostname.toLowerCase()))];
  if (requiresProtectedIngress && allowedAdminHosts.some((name) => allowedTrackingHosts.includes(name))) {
    throw new Error("遠端或 SaaS 模式的管理與追蹤 hostname 必須分離。");
  }
  if (isSaaS && (allowedAdminHosts.length !== 1 || allowedTrackingOrigins.length !== 1)) {
    throw new Error("SaaS tenant cell 必須各自設定一個精確管理 hostname 與追蹤 Origin。");
  }

  let tenantId: string | undefined;
  let tenantSlug: string | undefined;
  let dataRegion: string | undefined;
  let tenantDataRoot: string | undefined;
  let tenantConfigDigest: string | undefined;
  let limits = LOCAL_RUNTIME_LIMITS;

  if (isSaaS) {
    tenantId = requiredIdentifier(environment.SEA_TENANT_ID, "SEA_TENANT_ID");
    tenantSlug = requiredIdentifier(environment.SEA_TENANT_SLUG, "SEA_TENANT_SLUG");
    dataRegion = requiredIdentifier(environment.SEA_DATA_REGION, "SEA_DATA_REGION");
    const configuredRoot = requiredValue(environment.SEA_TENANT_DATA_ROOT, "SEA_TENANT_DATA_ROOT");
    if (!path.isAbsolute(configuredRoot)) throw new Error("SEA_TENANT_DATA_ROOT 必須是絕對路徑。");
    tenantDataRoot = path.resolve(configuredRoot);
    tenantConfigDigest = requiredValue(environment.SEA_TENANT_CONFIG_DIGEST, "SEA_TENANT_CONFIG_DIGEST").toLowerCase();
    if (!SHA256_PATTERN.test(tenantConfigDigest)) {
      throw new Error("SEA_TENANT_CONFIG_DIGEST 必須是 SHA-256 十六進位摘要。");
    }
    requiredValue(bootstrapToken, "SEA_BOOTSTRAP_TOKEN 或 SEA_BOOTSTRAP_TOKEN_FILE");
    requiredValue(masterKey, "SEA_MASTER_KEY 或 SEA_MASTER_KEY_FILE");
    limits = {
      maxActiveCampaigns: parseLimit(environment.SEA_MAX_ACTIVE_CAMPAIGNS, "SEA_MAX_ACTIVE_CAMPAIGNS", 1, 10_000),
      maxRecipientsPerCampaign: parseLimit(environment.SEA_MAX_RECIPIENTS_PER_CAMPAIGN, "SEA_MAX_RECIPIENTS_PER_CAMPAIGN", 1, 50_000),
      maxMonthlyMessages: parseLimit(environment.SEA_MAX_MONTHLY_MESSAGES, "SEA_MAX_MONTHLY_MESSAGES", 1, 10_000_000),
      maxReportArtifacts: parseLimit(environment.SEA_MAX_REPORT_ARTIFACTS, "SEA_MAX_REPORT_ARTIFACTS", 3, 100_000),
      maxThrottlePerMinute: parseLimit(environment.SEA_MAX_THROTTLE_PER_MINUTE, "SEA_MAX_THROTTLE_PER_MINUTE", 1, 600),
    };
  }

  const localDataRoot = path.join(PROJECT_ROOT, ".local-data");
  const resolvedPath = (configured: string | undefined, fallback: string, variable: string): string => {
    const candidate = configured?.trim() || fallback;
    return tenantDataRoot
      ? assertPathInside(tenantDataRoot, candidate, variable)
      : path.resolve(candidate);
  };
  const databasePath = resolvedPath(
    environment.SEA_DATABASE_PATH,
    tenantDataRoot ? path.join(tenantDataRoot, "database", "platform.sqlite") : path.join(localDataRoot, "platform.sqlite"),
    "SEA_DATABASE_PATH",
  );
  const pickupDirectory = resolvedPath(
    environment.SEA_PICKUP_DIRECTORY,
    tenantDataRoot ? path.join(tenantDataRoot, "pickup") : path.join(localDataRoot, "pickup"),
    "SEA_PICKUP_DIRECTORY",
  );
  const reportDirectory = resolvedPath(
    environment.SEA_REPORT_DIRECTORY,
    tenantDataRoot ? path.join(tenantDataRoot, "reports") : path.join(localDataRoot, "reports"),
    "SEA_REPORT_DIRECTORY",
  );
  const secretVaultPath = resolvedPath(
    environment.SEA_SECRET_VAULT_PATH,
    tenantDataRoot ? path.join(tenantDataRoot, "vault", "secrets.vault.json") : path.join(localDataRoot, "secrets.vault.json"),
    "SEA_SECRET_VAULT_PATH",
  );

  return {
    deploymentMode,
    tenantId,
    tenantSlug,
    dataRegion,
    tenantDataRoot,
    tenantConfigDigest,
    limits,
    host,
    port,
    databasePath,
    allowedAdminHosts,
    allowedTrackingHosts,
    allowedTrackingOrigins,
    secureCookies: environment.SEA_SECURE_COOKIES === "true",
    bootstrapToken,
    sessionTtlMs: 8 * 60 * 60 * 1000,
    pickupDirectory,
    reportDirectory,
    secretVaultPath,
    masterKey,
    workerEnabled: environment.SEA_WORKER_ENABLED !== "false",
    workerIntervalMs: 5_000,
  };
}

export { PROJECT_ROOT };
