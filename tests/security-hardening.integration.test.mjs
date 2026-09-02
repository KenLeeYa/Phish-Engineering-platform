import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createApp, redactRequestUrl } from "../dist/web/server.js";

const BOOTSTRAP_TOKEN = "security-hardening-bootstrap-token";

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

function auth(response, csrfRequired = true) {
  const cookie = cookieHeader(response);
  const headers = { cookie, "content-type": "application/json" };
  if (csrfRequired) headers["x-csrf-token"] = cookieValue(cookie, "sea_csrf");
  return headers;
}

async function login(app, username, password) {
  return app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { "content-type": "application/json" },
    payload: { username, password },
  });
}

async function createUser(app, administrator, user) {
  const response = await app.inject({
    method: "POST",
    url: "/api/users",
    headers: auth(administrator),
    payload: user,
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().user;
}

async function activateUser(app, username, initialPassword, newPassword) {
  const initial = await login(app, username, initialPassword);
  assert.equal(initial.statusCode, 200, initial.body);
  assert.equal(initial.json().passwordChangeRequired, true);
  const blocked = await app.inject({ method: "GET", url: "/api/campaigns", headers: auth(initial, false) });
  assert.equal(blocked.statusCode, 403, blocked.body);
  assert.equal(blocked.json().error.code, "PASSWORD_CHANGE_REQUIRED");
  const changed = await app.inject({
    method: "POST",
    url: "/api/auth/password",
    headers: auth(initial),
    payload: { currentPassword: initialPassword, newPassword },
  });
  assert.equal(changed.statusCode, 204, changed.body);
  const active = await login(app, username, newPassword);
  assert.equal(active.statusCode, 200, active.body);
  assert.equal(active.json().passwordChangeRequired, false);
  return active;
}

test("bootstrap, forced password change, RBAC and account revocation fail closed", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sea-security-"));
  const app = await createApp({
    databasePath: path.join(directory, "platform.sqlite"),
    allowedAdminHosts: ["localhost"],
    allowedTrackingOrigins: ["http://localhost"],
    bootstrapToken: BOOTSTRAP_TOKEN,
    workerEnabled: false,
  });
  context.after(async () => {
    await app.close();
    await fs.rm(directory, { recursive: true, force: true });
  });

  const missingToken = await app.inject({
    method: "POST",
    url: "/api/setup",
    headers: { "content-type": "application/json" },
    payload: { organizationName: "Security QA", displayName: "Admin", username: "admin", password: "Root-Safety-2026!" },
  });
  assert.equal(missingToken.statusCode, 403, missingToken.body);
  const wrongToken = await app.inject({
    method: "POST",
    url: "/api/setup",
    headers: { "content-type": "application/json", "x-bootstrap-token": "wrong" },
    payload: { organizationName: "Security QA", displayName: "Admin", username: "admin", password: "Root-Safety-2026!" },
  });
  assert.equal(wrongToken.statusCode, 403, wrongToken.body);
  const administrator = await app.inject({
    method: "POST",
    url: "/api/setup",
    headers: { "content-type": "application/json", "x-bootstrap-token": BOOTSTRAP_TOKEN },
    payload: { organizationName: "Security QA", displayName: "Admin", username: "admin", password: "Root-Safety-2026!" },
  });
  assert.equal(administrator.statusCode, 201, administrator.body);

  const reviewerUser = await createUser(app, administrator, {
    username: "reviewer",
    displayName: "Reviewer",
    role: "reviewer",
    password: "Blue-Initial-2026!",
  });
  const reportUser = await createUser(app, administrator, {
    username: "reporter",
    displayName: "Reporter",
    role: "report_viewer",
    password: "Green-Initial-2026!",
  });
  const reviewer = await activateUser(app, "reviewer", "Blue-Initial-2026!", "Blue-Changed-2026!");
  const reporter = await activateUser(app, "reporter", "Green-Initial-2026!", "Green-Changed-2026!");

  const reviewerBootstrap = await app.inject({ method: "GET", url: "/api/bootstrap", headers: auth(reviewer, false) });
  assert.equal(reviewerBootstrap.statusCode, 200, reviewerBootstrap.body);
  assert.equal(reviewerBootstrap.json().settings.scope, undefined);
  assert.equal((await app.inject({ method: "GET", url: "/api/templates", headers: auth(reviewer, false) })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/api/recipient-groups", headers: auth(reviewer, false) })).statusCode, 403);
  assert.equal((await app.inject({ method: "GET", url: "/api/connectors", headers: auth(reviewer, false) })).statusCode, 403);
  assert.equal((await app.inject({ method: "GET", url: "/api/users", headers: auth(reviewer, false) })).statusCode, 403);
  assert.equal((await app.inject({ method: "GET", url: "/api/report-artifacts", headers: auth(reporter, false) })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/api/templates", headers: auth(reporter, false) })).statusCode, 403);

  const disabled = await app.inject({
    method: "PATCH",
    url: `/api/users/${reviewerUser.id}`,
    headers: auth(administrator),
    payload: { role: "reviewer", status: "disabled" },
  });
  assert.equal(disabled.statusCode, 200, disabled.body);
  assert.equal((await app.inject({ method: "GET", url: "/api/auth/session", headers: auth(reviewer, false) })).statusCode, 401);
  assert.equal((await login(app, "reviewer", "Blue-Changed-2026!")).statusCode, 401);

  const reenabled = await app.inject({
    method: "PATCH",
    url: `/api/users/${reviewerUser.id}`,
    headers: auth(administrator),
    payload: { role: "reviewer", status: "active" },
  });
  assert.equal(reenabled.statusCode, 200, reenabled.body);
  const reset = await app.inject({
    method: "POST",
    url: `/api/users/${reportUser.id}/reset-password`,
    headers: auth(administrator),
    payload: { password: "Amber-Reset-2026!" },
  });
  assert.equal(reset.statusCode, 204, reset.body);
  assert.equal((await app.inject({ method: "GET", url: "/api/auth/session", headers: auth(reporter, false) })).statusCode, 401);
});

test("login throttling blocks both the account and source address after repeated failures", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sea-throttle-"));
  const app = await createApp({
    databasePath: path.join(directory, "platform.sqlite"),
    allowedAdminHosts: ["localhost"],
    allowedTrackingOrigins: ["http://localhost"],
    bootstrapToken: BOOTSTRAP_TOKEN,
    workerEnabled: false,
  });
  context.after(async () => {
    await app.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const setup = await app.inject({
    method: "POST",
    url: "/api/setup",
    headers: { "content-type": "application/json", "x-bootstrap-token": BOOTSTRAP_TOKEN },
    payload: { organizationName: "Throttle QA", displayName: "Admin", username: "admin", password: "Root-Safety-2026!" },
  });
  assert.equal(setup.statusCode, 201, setup.body);
  for (let index = 0; index < 5; index += 1) {
    const failure = await login(app, "admin", `Wrong-Password-${index}!`);
    assert.equal(failure.statusCode, 401, failure.body);
  }
  const blocked = await login(app, "admin", "Root-Safety-2026!");
  assert.equal(blocked.statusCode, 429, blocked.body);
  assert.equal(blocked.json().error.code, "LOGIN_THROTTLED");
});

test("audit export is complete beyond ten thousand records and declares its assurance boundary", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sea-audit-"));
  const databasePath = path.join(directory, "platform.sqlite");
  const app = await createApp({
    databasePath,
    allowedAdminHosts: ["localhost"],
    allowedTrackingOrigins: ["http://localhost"],
    bootstrapToken: BOOTSTRAP_TOKEN,
    workerEnabled: false,
  });
  context.after(async () => {
    await app.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const administrator = await app.inject({
    method: "POST",
    url: "/api/setup",
    headers: { "content-type": "application/json", "x-bootstrap-token": BOOTSTRAP_TOKEN },
    payload: { organizationName: "Audit QA", displayName: "Admin", username: "admin", password: "Root-Safety-2026!" },
  });
  assert.equal(administrator.statusCode, 201, administrator.body);
  const database = new DatabaseSync(databasePath);
  const insert = database.prepare(`
    INSERT INTO audit_log(occurred_at, actor_user_id, action, object_type, object_id, metadata_json)
    VALUES (?, NULL, 'qa.audit_volume', 'qa', ?, '{}')
  `);
  database.exec("BEGIN IMMEDIATE");
  for (let index = 0; index < 10_005; index += 1) insert.run(new Date().toISOString(), String(index));
  database.exec("COMMIT");
  database.close();
  const exported = await app.inject({ method: "GET", url: "/api/audit/export", headers: auth(administrator, false) });
  assert.equal(exported.statusCode, 200, exported.body.slice(0, 500));
  const payload = exported.json();
  assert.equal(payload.complete, true);
  assert.equal(payload.assurance, "exported_file_consistency_only");
  assert.equal(payload.totalRecords, payload.records.length);
  assert.ok(payload.totalRecords > 10_000);
  assert.equal(payload.firstRecordId, payload.records[0].id);
  assert.equal(payload.lastRecordId, payload.records.at(-1).id);
});

test("request log redaction removes query strings and all public tracking tokens", () => {
  assert.equal(redactRequestUrl("/api/login?password=secret"), "/api/login");
  assert.equal(redactRequestUrl("/t/o/opaque-token.gif?scanner=1"), "/t/o/[token]");
  assert.equal(redactRequestUrl("/t/a/opaque-token/attachment-id"), "/t/a/[token]/[attachment]");
  assert.equal(redactRequestUrl("/training/opaque-token/ack"), "/training/[token]/ack");
});
