import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../dist/web/server.js";

const BOOTSTRAP_TOKEN = "server-integration-bootstrap-token";

function cookieHeader(response) {
  const raw = response.headers["set-cookie"];
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return values.map((value) => value.split(";", 1)[0]).join("; ");
}

function cookieValue(header, name) {
  const prefix = `${name}=`;
  const item = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : "";
}

test("local core supports one-time setup, guarded settings, login and logout", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "local-awareness-test-"));
  const app = await createApp({
    databasePath: path.join(directory, "platform.sqlite"),
    allowedAdminHosts: ["localhost"],
    allowedTrackingOrigins: ["http://localhost"],
    bootstrapToken: BOOTSTRAP_TOKEN,
    sessionTtlMs: 60 * 60 * 1000,
  });
  context.after(async () => {
    await app.close();
    await fs.rm(directory, { recursive: true, force: true });
  });

  const health = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().mailSendingEnabled, false);
  assert.equal(health.json().phase, 5);
  assert.equal(health.json().deploymentMode, "local_single_tenant");
  assert.equal(health.json().tenant, undefined);

  const beforeSetup = await app.inject({ method: "GET", url: "/api/bootstrap" });
  assert.deepEqual(beforeSetup.json(), { setupRequired: true, authenticated: false });

  const setup = await app.inject({
    method: "POST",
    url: "/api/setup",
    headers: { "content-type": "application/json", "x-bootstrap-token": BOOTSTRAP_TOKEN },
    payload: {
      organizationName: "客戶測試公司",
      displayName: "安全管理員",
      username: "admin",
      password: "Safety-River-2026!",
    },
  });
  assert.equal(setup.statusCode, 201, setup.body);
  assert.equal(setup.json().readiness.mailSendingEnabled, false);
  const cookies = cookieHeader(setup);
  const csrf = cookieValue(cookies, "sea_csrf");
  assert.ok(cookies.includes("sea_session="));
  assert.ok(csrf);

  const duplicateSetup = await app.inject({
    method: "POST",
    url: "/api/setup",
    headers: { "content-type": "application/json", "x-bootstrap-token": BOOTSTRAP_TOKEN },
    payload: {
      organizationName: "另一家公司",
      displayName: "另一位管理員",
      username: "second-admin",
      password: "Another-Safety-2026!",
    },
  });
  assert.equal(duplicateSetup.statusCode, 409);

  const session = await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: cookies } });
  assert.equal(session.statusCode, 200);
  assert.equal(session.json().user.username, "admin");

  const missingCsrf = await app.inject({
    method: "PATCH",
    url: "/api/settings",
    headers: { cookie: cookies, "content-type": "application/json" },
    payload: { organizationName: "不可寫入" },
  });
  assert.equal(missingCsrf.statusCode, 403);

  const unsafeMailbox = await app.inject({
    method: "PATCH",
    url: "/api/settings",
    headers: {
      cookie: cookies,
      "content-type": "application/json",
      "x-csrf-token": csrf,
    },
    payload: {
      recipientDomains: ["customer.example"],
      testRecipientEmails: ["outside@example.net"],
    },
  });
  assert.equal(unsafeMailbox.statusCode, 400);

  const settingsUpdate = await app.inject({
    method: "PATCH",
    url: "/api/settings",
    headers: {
      cookie: cookies,
      "content-type": "application/json",
      "x-csrf-token": csrf,
    },
    payload: {
      organizationName: "客戶測試公司",
      timezone: "Asia/Taipei",
      retentionDays: 365,
      recipientDomains: ["customer.example"],
      senderDomains: ["awareness.customer.example"],
      testRecipientEmails: ["awareness-test@customer.example"],
    },
  });
  assert.equal(settingsUpdate.statusCode, 200, settingsUpdate.body);
  assert.equal(settingsUpdate.json().readiness.readyCount, 10);
  assert.equal(settingsUpdate.json().settings.delivery.enabled, false);

  const logout = await app.inject({
    method: "POST",
    url: "/api/auth/logout",
    headers: { cookie: cookies, "x-csrf-token": csrf },
  });
  assert.equal(logout.statusCode, 204, logout.body);

  const expiredSession = await app.inject({
    method: "GET",
    url: "/api/auth/session",
    headers: { cookie: cookies },
  });
  assert.equal(expiredSession.statusCode, 401);

  const wrongPassword = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { "content-type": "application/json" },
    payload: { username: "admin", password: "wrong-password" },
  });
  assert.equal(wrongPassword.statusCode, 401);

  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { "content-type": "application/json" },
    payload: { username: "admin", password: "Safety-River-2026!" },
  });
  assert.equal(login.statusCode, 200, login.body);
  assert.ok(cookieHeader(login).includes("sea_session="));
});

test("SaaS health exposes tenant identity without runtime paths or secrets", async (context) => {
  const app = await createApp({
    databasePath: ":memory:",
    allowedAdminHosts: ["admin.customer.example"],
    allowedTrackingHosts: ["training.customer.example"],
    allowedTrackingOrigins: ["https://training.customer.example"],
    deploymentMode: "saas_tenant_cell",
    tenantId: "tenant-demo-001",
    tenantSlug: "demo-enterprise",
    dataRegion: "tw-north-1",
    tenantConfigDigest: "a".repeat(64),
  });
  context.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/api/health",
    headers: { host: "admin.customer.example" },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json().tenant, {
    id: "tenant-demo-001",
    slug: "demo-enterprise",
    dataRegion: "tw-north-1",
    configDigest: "a".repeat(64),
  });
  assert.doesNotMatch(response.body, /database|vault|bootstrap|masterKey/i);
});
