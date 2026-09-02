import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface RuntimeConfig {
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

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("SEA_PORT 必須是 1 到 65535 的整數。");
  }
  return port;
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
  const host = environment.SEA_BIND_HOST?.trim() || "127.0.0.1";
  const isLoopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
  const port = parsePort(environment.SEA_PORT ?? "4280");
  if (!isLoopback && environment.SEA_ALLOW_REMOTE_ADMIN !== "true") {
    throw new Error(
      "管理介面預設只允許 loopback；遠端 Pilot 必須明確設定 SEA_ALLOW_REMOTE_ADMIN=true 與 SEA_ADMIN_HOSTNAMES。",
    );
  }
  if (!isLoopback && !environment.SEA_ADMIN_HOSTNAMES?.trim()) {
    throw new Error("遠端 Pilot 必須明確設定 SEA_ADMIN_HOSTNAMES，不接受未限定的 Host。");
  }
  if (!isLoopback && environment.SEA_SECURE_COOKIES !== "true") {
    throw new Error("遠端 Pilot 必須設定 SEA_SECURE_COOKIES=true。");
  }
  if (!isLoopback && environment.SEA_REMOTE_HTTPS_PROXY !== "true") {
    throw new Error("遠端 Pilot 必須明確設定 SEA_REMOTE_HTTPS_PROXY=true，確認由 HTTPS reverse proxy 保護。");
  }
  if (!isLoopback && !environment.SEA_TRACKING_ORIGINS?.trim()) {
    throw new Error("遠端 Pilot 必須設定客戶自有的精確 SEA_TRACKING_ORIGINS。");
  }

  const allowedAdminHosts = normalizedHosts(environment.SEA_ADMIN_HOSTNAMES, host);
  const allowedTrackingOrigins = normalizedTrackingOrigins(environment.SEA_TRACKING_ORIGINS, isLoopback, port);
  const allowedTrackingHosts = [...new Set(allowedTrackingOrigins.map((origin) => new URL(origin).hostname.toLowerCase()))];
  if (!isLoopback && allowedAdminHosts.some((name) => allowedTrackingHosts.includes(name))) {
    throw new Error("遠端 Pilot 的管理與追蹤 hostname 必須分離。");
  }

  const databasePath = environment.SEA_DATABASE_PATH?.trim()
    ? path.resolve(environment.SEA_DATABASE_PATH)
    : path.join(PROJECT_ROOT, ".local-data", "platform.sqlite");

  return {
    host,
    port,
    databasePath,
    allowedAdminHosts,
    allowedTrackingHosts,
    allowedTrackingOrigins,
    secureCookies: environment.SEA_SECURE_COOKIES === "true",
    bootstrapToken: environment.SEA_BOOTSTRAP_TOKEN?.trim() || undefined,
    sessionTtlMs: 8 * 60 * 60 * 1000,
    pickupDirectory: path.resolve(environment.SEA_PICKUP_DIRECTORY?.trim() || path.join(PROJECT_ROOT, ".local-data", "pickup")),
    reportDirectory: path.resolve(environment.SEA_REPORT_DIRECTORY?.trim() || path.join(PROJECT_ROOT, ".local-data", "reports")),
    secretVaultPath: path.resolve(environment.SEA_SECRET_VAULT_PATH?.trim() || path.join(PROJECT_ROOT, ".local-data", "secrets.vault.json")),
    masterKey: environment.SEA_MASTER_KEY,
    workerEnabled: environment.SEA_WORKER_ENABLED !== "false",
    workerIntervalMs: 5_000,
  };
}

export { PROJECT_ROOT };
