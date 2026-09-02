import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createApp } from "../dist/web/server.js";

const BOOTSTRAP_TOKEN = "migration-integration-bootstrap-token";

test("Phase 2 migration preserves an initialized Phase 1 platform", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "local-awareness-migration-"));
  const databasePath = path.join(directory, "platform.sqlite");
  let upgradedApp;
  context.after(async () => {
    if (upgradedApp) await upgradedApp.close();
    await fs.rm(directory, { recursive: true, force: true });
  });

  const initialApp = await createApp({
    databasePath,
    allowedAdminHosts: ["localhost"],
    allowedTrackingOrigins: ["http://localhost"],
    bootstrapToken: BOOTSTRAP_TOKEN,
  });
  const setup = await initialApp.inject({
    method: "POST",
    url: "/api/setup",
    headers: { "content-type": "application/json", "x-bootstrap-token": BOOTSTRAP_TOKEN },
    payload: {
      organizationName: "既有客戶",
      displayName: "既有管理員",
      username: "existing-admin",
      password: "Migration-Safety-2026!",
    },
  });
  assert.equal(setup.statusCode, 201, setup.body);
  await initialApp.close();

  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys = OFF;
    DROP TABLE template_attachments;
    DROP TABLE email_template_versions;
    DROP TABLE email_templates;
    DROP TABLE recipient_group_members;
    DROP TABLE recipients;
    DROP TABLE recipient_groups;
    DELETE FROM schema_migrations WHERE version = 2;
    PRAGMA foreign_keys = ON;
  `);
  database.close();

  upgradedApp = await createApp({
    databasePath,
    allowedAdminHosts: ["localhost"],
    allowedTrackingOrigins: ["http://localhost"],
    bootstrapToken: BOOTSTRAP_TOKEN,
  });
  const login = await upgradedApp.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { "content-type": "application/json" },
    payload: { username: "existing-admin", password: "Migration-Safety-2026!" },
  });
  assert.equal(login.statusCode, 200, login.body);

  const cookie = (Array.isArray(login.headers["set-cookie"])
    ? login.headers["set-cookie"]
    : [login.headers["set-cookie"]])
    .filter(Boolean)
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  const groups = await upgradedApp.inject({
    method: "GET",
    url: "/api/recipient-groups",
    headers: { cookie },
  });
  assert.equal(groups.statusCode, 200, groups.body);
  assert.deepEqual(groups.json(), { groups: [] });
});
