import { readRuntimeConfig } from "./config.js";
import { createApp } from "./web/server.js";

const runtime = readRuntimeConfig();
const app = await createApp({
  deploymentMode: runtime.deploymentMode,
  tenantId: runtime.tenantId,
  tenantSlug: runtime.tenantSlug,
  dataRegion: runtime.dataRegion,
  tenantConfigDigest: runtime.tenantConfigDigest,
  limits: runtime.limits,
  databasePath: runtime.databasePath,
  allowedAdminHosts: runtime.allowedAdminHosts,
  allowedTrackingHosts: runtime.allowedTrackingHosts,
  allowedTrackingOrigins: runtime.allowedTrackingOrigins,
  secureCookies: runtime.secureCookies,
  bootstrapToken: runtime.bootstrapToken,
  sessionTtlMs: runtime.sessionTtlMs,
  pickupDirectory: runtime.pickupDirectory,
  reportDirectory: runtime.reportDirectory,
  secretVaultPath: runtime.secretVaultPath,
  masterKey: runtime.masterKey,
  workerEnabled: runtime.workerEnabled,
  workerIntervalMs: runtime.workerIntervalMs,
  logger: true,
});

await app.listen({ host: runtime.host, port: runtime.port });
console.log(`Security Awareness Platform 已啟動：http://${runtime.host}:${runtime.port}`);
console.log("寄信能力由已驗證連接器與緊急停止狀態動態決定。");

let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await app.close();
};

process.once("SIGINT", close);
process.once("SIGTERM", close);
