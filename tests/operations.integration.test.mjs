import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createApp } from "../dist/web/server.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BOOTSTRAP_TOKEN = "operations-integration-bootstrap-token";

function runMaintenance(arguments_) {
  const result = spawnSync(process.execPath, [path.join(PROJECT_ROOT, "scripts", "maintenance.mjs"), ...arguments_], {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

test("retention maintenance dry-run and apply cover database PII, reports, pickup and service logs", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sea-operations-"));
  const databasePath = path.join(directory, "platform.sqlite");
  const reportDirectory = path.join(directory, "reports");
  const pickupDirectory = path.join(directory, "pickup");
  const logDirectory = path.join(directory, "logs");
  const app = await createApp({
    databasePath,
    reportDirectory,
    pickupDirectory,
    allowedAdminHosts: ["localhost"],
    allowedTrackingOrigins: ["http://localhost"],
    bootstrapToken: BOOTSTRAP_TOKEN,
    workerEnabled: false,
  });
  context.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  const setup = await app.inject({
    method: "POST",
    url: "/api/setup",
    headers: { "content-type": "application/json", "x-bootstrap-token": BOOTSTRAP_TOKEN },
    payload: { organizationName: "Operations QA", displayName: "Admin", username: "admin", password: "Root-Safety-2026!" },
  });
  assert.equal(setup.statusCode, 201, setup.body);
  await app.close();

  await fs.mkdir(reportDirectory, { recursive: true });
  await fs.mkdir(pickupDirectory, { recursive: true });
  await fs.mkdir(logDirectory, { recursive: true });
  const artifactPath = path.join(reportDirectory, "expired-report.json");
  const pickupPath = path.join(pickupDirectory, "expired.eml");
  const currentLogPath = path.join(logDirectory, "service.stdout.log");
  const rotatedLogPath = path.join(logDirectory, "service.stderr.log.1");
  await fs.writeFile(artifactPath, "{}\n");
  await fs.writeFile(pickupPath, "expired pickup\n");
  await fs.writeFile(currentLogPath, "expired current log\n");
  await fs.writeFile(rotatedLogPath, "expired rotated log\n");
  const oldDate = new Date(Date.now() - 40 * 86_400_000);
  for (const filePath of [artifactPath, pickupPath, currentLogPath, rotatedLogPath]) {
    await fs.utimes(filePath, oldDate, oldDate);
  }

  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON");
  const user = database.prepare("SELECT id FROM app_users LIMIT 1").get();
  const settingsRow = database.prepare("SELECT value_json FROM platform_settings WHERE setting_key = 'platform'").get();
  const settings = JSON.parse(String(settingsRow.value_json));
  settings.organization.retentionDays = 30;
  database.prepare("UPDATE platform_settings SET value_json = ? WHERE setting_key = 'platform'").run(JSON.stringify(settings));
  const oldIso = oldDate.toISOString();
  database.prepare(`
    INSERT INTO auth_sessions(session_hash, user_id, csrf_hash, created_at, expires_at, last_seen_at)
    VALUES ('expired-session', ?, 'expired-csrf', ?, ?, ?)
  `).run(user.id, oldIso, oldIso, oldIso);
  database.prepare(`
    INSERT INTO recipient_groups(id, name, name_normalized, description, created_by, created_at, updated_at)
    VALUES ('expired-group', 'Expired Group', 'expired group', '', ?, ?, ?)
  `).run(user.id, oldIso, oldIso);
  database.prepare(`
    INSERT INTO recipients(id, email, email_normalized, display_name, department, business_unit, created_at, updated_at)
    VALUES ('expired-recipient', 'expired@example.test', 'expired@example.test', 'Expired', '', '', ?, ?)
  `).run(oldIso, oldIso);
  database.prepare(`
    INSERT INTO recipient_group_members(group_id, recipient_id, added_at)
    VALUES ('expired-group', 'expired-recipient', ?)
  `).run(oldIso);
  database.prepare(`
    INSERT INTO external_report_jobs(id, source_file_name, target_count, created_by, created_at)
    VALUES ('expired-job', 'expired.xlsx', NULL, ?, ?)
  `).run(user.id, oldIso);
  database.prepare(`
    INSERT INTO report_artifacts(id, campaign_id, external_job_id, format, file_name, file_path, sha256, size_bytes, created_by, created_at)
    VALUES ('expired-artifact', NULL, 'expired-job', 'json', 'expired-report.json', ?, ?, 3, ?, ?)
  `).run(artifactPath, "0".repeat(64), user.id, oldIso);
  database.prepare(`
    INSERT INTO audit_log(occurred_at, actor_user_id, action, object_type, object_id, metadata_json)
    VALUES (?, NULL, 'qa.expired', 'qa', NULL, '{}')
  `).run(oldIso);
  database.close();

  const arguments_ = [
    "--database", databasePath,
    "--reports", reportDirectory,
    "--pickup", pickupDirectory,
    "--logs", logDirectory,
  ];
  const dryRun = runMaintenance(arguments_);
  assert.equal(dryRun.mode, "dry-run");
  assert.equal(dryRun.counts.expiredSessions, 1);
  assert.equal(dryRun.counts.expiredArtifacts, 1);
  assert.equal(dryRun.counts.expiredMemberships, 1);
  assert.equal(dryRun.counts.pickupFiles, 1);
  assert.equal(dryRun.counts.serviceLogFiles, 2);
  assert.equal((await fs.stat(artifactPath)).isFile(), true);

  const applied = runMaintenance([...arguments_, "--apply"]);
  assert.equal(applied.applied, true);
  assert.equal(applied.failedFiles, 0);
  await assert.rejects(fs.stat(artifactPath), { code: "ENOENT" });
  await assert.rejects(fs.stat(pickupPath), { code: "ENOENT" });
  await assert.rejects(fs.stat(rotatedLogPath), { code: "ENOENT" });
  assert.equal(await fs.readFile(currentLogPath, "utf8"), "");

  const verified = new DatabaseSync(databasePath);
  assert.equal(verified.prepare("SELECT COUNT(*) AS count FROM auth_sessions WHERE session_hash = 'expired-session'").get().count, 0);
  assert.equal(verified.prepare("SELECT COUNT(*) AS count FROM report_artifacts WHERE id = 'expired-artifact'").get().count, 0);
  assert.equal(verified.prepare("SELECT COUNT(*) AS count FROM recipients WHERE id = 'expired-recipient'").get().count, 0);
  assert.equal(verified.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'maintenance.retention_applied'").get().count, 1);
  verified.close();
});
