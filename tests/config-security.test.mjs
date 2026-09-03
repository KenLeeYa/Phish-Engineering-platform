import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readRuntimeConfig } from "../dist/config.js";

const remoteBaseline = {
  SEA_BIND_HOST: "0.0.0.0",
  SEA_PORT: "4280",
  SEA_ALLOW_REMOTE_ADMIN: "true",
  SEA_ADMIN_HOSTNAMES: "admin.customer.example",
  SEA_SECURE_COOKIES: "true",
  SEA_REMOTE_HTTPS_PROXY: "true",
  SEA_TRACKING_ORIGINS: "https://training.customer.example",
};

const tenantRoot = path.resolve(os.tmpdir(), "sea-saas-config-test", "tenant-demo-001");
const saasBaseline = {
  ...remoteBaseline,
  SEA_DEPLOYMENT_MODE: "saas_tenant_cell",
  SEA_TENANT_ID: "tenant-demo-001",
  SEA_TENANT_SLUG: "demo-enterprise",
  SEA_DATA_REGION: "tw-north-1",
  SEA_TENANT_CONFIG_DIGEST: "a".repeat(64),
  SEA_TENANT_DATA_ROOT: tenantRoot,
  SEA_BOOTSTRAP_TOKEN: "runtime-injected-bootstrap-token",
  SEA_MASTER_KEY: "runtime-injected-master-key",
  SEA_MAX_ACTIVE_CAMPAIGNS: "25",
  SEA_MAX_RECIPIENTS_PER_CAMPAIGN: "5000",
  SEA_MAX_MONTHLY_MESSAGES: "50000",
  SEA_MAX_REPORT_ARTIFACTS: "3000",
  SEA_MAX_THROTTLE_PER_MINUTE: "120",
};

test("remote administration requires HTTPS acknowledgement, secure cookies and distinct exact hostnames", () => {
  assert.throws(
    () => readRuntimeConfig({ ...remoteBaseline, SEA_SECURE_COOKIES: "false" }),
    /SEA_SECURE_COOKIES/,
  );
  assert.throws(
    () => readRuntimeConfig({ ...remoteBaseline, SEA_REMOTE_HTTPS_PROXY: "false" }),
    /SEA_REMOTE_HTTPS_PROXY/,
  );
  assert.throws(
    () => readRuntimeConfig({ ...remoteBaseline, SEA_TRACKING_ORIGINS: "http://training.customer.example" }),
    /HTTPS/,
  );
  assert.throws(
    () => readRuntimeConfig({ ...remoteBaseline, SEA_TRACKING_ORIGINS: "https://admin.customer.example" }),
    /必須分離/,
  );
  const config = readRuntimeConfig(remoteBaseline);
  assert.deepEqual(config.allowedAdminHosts, ["admin.customer.example"]);
  assert.deepEqual(config.allowedTrackingHosts, ["training.customer.example"]);
  assert.deepEqual(config.allowedTrackingOrigins, ["https://training.customer.example"]);
  assert.equal(config.secureCookies, true);
});

test("SaaS tenant cell requires identity, secret injection, limits and isolated paths", () => {
  const config = readRuntimeConfig(saasBaseline);
  assert.equal(config.deploymentMode, "saas_tenant_cell");
  assert.equal(config.tenantId, "tenant-demo-001");
  assert.equal(config.limits.maxMonthlyMessages, 50_000);
  assert.ok(config.databasePath.startsWith(`${tenantRoot}${path.sep}`));
  assert.ok(config.reportDirectory.startsWith(`${tenantRoot}${path.sep}`));

  assert.throws(
    () => readRuntimeConfig({ ...saasBaseline, SEA_MASTER_KEY: "" }),
    /SEA_MASTER_KEY/,
  );
  assert.throws(
    () => readRuntimeConfig({ ...saasBaseline, SEA_TENANT_CONFIG_DIGEST: "invalid" }),
    /SHA-256/,
  );
  assert.throws(
    () => readRuntimeConfig({ ...saasBaseline, SEA_MAX_MONTHLY_MESSAGES: "" }),
    /SEA_MAX_MONTHLY_MESSAGES/,
  );
  assert.throws(
    () => readRuntimeConfig({
      ...saasBaseline,
      SEA_ADMIN_HOSTNAMES: "admin.customer.example,secondary.customer.example",
    }),
    /一個精確管理 hostname/,
  );
  assert.throws(
    () => readRuntimeConfig({
      ...saasBaseline,
      SEA_DATABASE_PATH: path.resolve(tenantRoot, "..", "other-tenant", "platform.sqlite"),
    }),
    /SEA_TENANT_DATA_ROOT/,
  );
});

test("SaaS mode cannot inherit loopback development ingress defaults", () => {
  assert.throws(
    () => readRuntimeConfig({
      SEA_DEPLOYMENT_MODE: "saas_tenant_cell",
      SEA_TENANT_ID: "tenant-demo-001",
    }),
    /SEA_ALLOW_REMOTE_ADMIN/,
  );
});

test("SaaS runtime reads secrets from absolute files without allowing ambiguous sources", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sea-runtime-secrets-"));
  const bootstrapFile = path.join(directory, "bootstrap");
  const masterKeyFile = path.join(directory, "master-key");
  fs.writeFileSync(bootstrapFile, "synthetic-bootstrap-value\n", { mode: 0o600 });
  fs.writeFileSync(masterKeyFile, "synthetic-master-key-value\n", { mode: 0o600 });
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const fileBacked = {
    ...saasBaseline,
    SEA_BOOTSTRAP_TOKEN: undefined,
    SEA_MASTER_KEY: undefined,
    SEA_BOOTSTRAP_TOKEN_FILE: bootstrapFile,
    SEA_MASTER_KEY_FILE: masterKeyFile,
  };
  const config = readRuntimeConfig(fileBacked);
  assert.equal(config.bootstrapToken, "synthetic-bootstrap-value");
  assert.equal(config.masterKey, "synthetic-master-key-value");
  assert.throws(
    () => readRuntimeConfig({ ...fileBacked, SEA_MASTER_KEY: "ambiguous-direct-value" }),
    /不可同時設定/,
  );
});
