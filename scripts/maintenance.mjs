import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function safeRoot(value, label) {
  const resolved = value ? path.resolve(value) : "";
  if (!resolved) return "";
  if (resolved === path.parse(resolved).root) throw new Error(`${label} 不可使用檔案系統根目錄。`);
  return resolved;
}

function inside(root, candidate) {
  const resolved = path.resolve(candidate);
  return resolved !== root && resolved.startsWith(`${root}${path.sep}`);
}

async function filesOlderThan(root, cutoffMs, matcher = () => true) {
  if (!root) return [];
  const output = [];
  const visit = async (directory) => {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const candidate = path.resolve(directory, entry.name);
      if (!inside(root, candidate)) throw new Error(`檔案逸出允許目錄：${candidate}`);
      if (entry.isDirectory()) await visit(candidate);
      else if (entry.isFile() && matcher(entry.name)) {
        const stats = await fs.stat(candidate);
        if (stats.mtimeMs < cutoffMs) output.push(candidate);
      }
    }
  };
  await visit(root);
  return output;
}

const databasePath = safeRoot(argument("--database"), "DatabasePath");
const reportDirectory = safeRoot(argument("--reports"), "ReportDirectory");
const pickupDirectory = safeRoot(argument("--pickup"), "PickupDirectory");
const logDirectory = safeRoot(argument("--logs"), "LogDirectory");
const apply = process.argv.includes("--apply");
if (!databasePath || !reportDirectory) {
  throw new Error(
    "Usage: node scripts/maintenance.mjs --database <platform.sqlite> --reports <report-dir> [--pickup <pickup-dir>] [--logs <log-dir>] [--apply]",
  );
}
const databaseStats = await fs.stat(databasePath);
if (!databaseStats.isFile()) throw new Error("DatabasePath 必須是既有 SQLite 檔案。");

const database = new DatabaseSync(databasePath);
try {
  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const integrity = database.prepare("PRAGMA quick_check").all();
  if (integrity.some((row) => String(row.quick_check ?? "") !== "ok")) {
    throw new Error("SQLite quick_check 未通過，拒絕執行保存期限維護。");
  }
  const settingsRow = database.prepare("SELECT value_json FROM platform_settings WHERE setting_key = 'platform'").get();
  if (!settingsRow) throw new Error("Platform settings are missing.");
  const settings = JSON.parse(String(settingsRow.value_json));
  const retentionDays = Number(settings.organization?.retentionDays);
  if (!Number.isInteger(retentionDays) || retentionDays < 30 || retentionDays > 3_650) {
    throw new Error("Invalid retentionDays setting.");
  }
  const now = new Date();
  const nowIso = now.toISOString();
  const cutoffMs = now.getTime() - retentionDays * 86_400_000;
  const cutoff = new Date(cutoffMs).toISOString();
  const scalar = (sql, ...parameters) => Number(database.prepare(sql).get(...parameters).count);
  const expiredCampaignIds = (database.prepare(`
    SELECT id FROM campaigns
    WHERE status IN ('completed', 'cancelled') AND updated_at < ?
  `).all(cutoff)).map((row) => String(row.id));
  const artifactRows = database.prepare(`
    SELECT ra.id, ra.file_path
    FROM report_artifacts ra
    LEFT JOIN campaigns c ON c.id = ra.campaign_id
    LEFT JOIN external_report_jobs ej ON ej.id = ra.external_job_id
    WHERE ra.created_at < ?
       OR (c.status IN ('completed', 'cancelled') AND c.updated_at < ?)
       OR ej.created_at < ?
    ORDER BY ra.created_at
  `).all(cutoff, cutoff, cutoff);
  const artifactPaths = artifactRows.map((artifact) => {
    const resolved = path.resolve(String(artifact.file_path));
    if (!inside(reportDirectory, resolved)) throw new Error(`報表路徑逸出允許目錄：${resolved}`);
    return resolved;
  });
  const pickupFiles = await filesOlderThan(pickupDirectory, cutoffMs, (name) => name.toLowerCase().endsWith(".eml"));
  const logFiles = await filesOlderThan(
    logDirectory,
    cutoffMs,
    (name) => /^service\.(stdout|stderr)\.log(?:\..+)?$/i.test(name),
  );
  const counts = {
    expiredSessions: scalar("SELECT COUNT(*) AS count FROM auth_sessions WHERE expires_at <= ?", nowIso),
    expiredEvents: scalar("SELECT COUNT(*) AS count FROM simulation_events WHERE occurred_at < ?", cutoff),
    expiredTargets: scalar("SELECT COUNT(*) AS count FROM campaign_targets WHERE expires_at IS NOT NULL AND expires_at <= ? AND revoked_at IS NULL", nowIso),
    expiredCampaigns: expiredCampaignIds.length,
    expiredArtifacts: artifactRows.length,
    expiredExternalJobs: scalar("SELECT COUNT(*) AS count FROM external_report_jobs WHERE created_at < ?", cutoff),
    expiredMemberships: scalar("SELECT COUNT(*) AS count FROM recipient_group_members WHERE added_at < ?", cutoff),
    expiredAuditRecords: scalar("SELECT COUNT(*) AS count FROM audit_log WHERE occurred_at < ?", cutoff),
    pickupFiles: pickupFiles.length,
    serviceLogFiles: logFiles.length,
  };
  const result = { mode: apply ? "apply" : "dry-run", retentionDays, cutoff, counts };
  if (!apply) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(nowIso);
      database.prepare("DELETE FROM simulation_events WHERE occurred_at < ?").run(cutoff);
      database.prepare(`
        UPDATE deliveries
        SET status = 'cancelled', last_error_code = 'TOKEN_EXPIRED',
            last_error_message = '追蹤有效期已結束，未寄送目標已取消。', updated_at = ?
        WHERE status = 'queued' AND campaign_target_id IN (
          SELECT id FROM campaign_targets WHERE expires_at IS NOT NULL AND expires_at <= ?
        )
      `).run(nowIso, nowIso);
      database.prepare(`
        UPDATE campaign_targets
        SET revoked_at = COALESCE(revoked_at, ?), tracking_token = ''
        WHERE expires_at IS NOT NULL AND expires_at <= ?
      `).run(nowIso, nowIso);
      for (const artifact of artifactRows) {
        database.prepare("DELETE FROM report_artifacts WHERE id = ?").run(artifact.id);
      }
      database.prepare("DELETE FROM external_report_jobs WHERE created_at < ?").run(cutoff);
      for (const campaignId of expiredCampaignIds) {
        database.prepare("DELETE FROM campaigns WHERE id = ?").run(campaignId);
      }
      database.prepare("DELETE FROM recipient_group_members WHERE added_at < ?").run(cutoff);
      database.prepare(`
        DELETE FROM recipients
        WHERE NOT EXISTS (SELECT 1 FROM recipient_group_members m WHERE m.recipient_id = recipients.id)
          AND NOT EXISTS (SELECT 1 FROM campaign_targets ct WHERE ct.recipient_id = recipients.id)
          AND NOT EXISTS (SELECT 1 FROM campaign_review_recipients rr WHERE rr.recipient_id = recipients.id)
      `).run();
      database.prepare("DELETE FROM audit_log WHERE occurred_at < ?").run(cutoff);
      database.prepare(`
        INSERT INTO audit_log(occurred_at, actor_user_id, action, object_type, object_id, metadata_json)
        VALUES (?, NULL, 'maintenance.retention_applied', 'platform', 'local', ?)
      `).run(nowIso, JSON.stringify({ retentionDays, cutoff, counts }));
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }

    const fileResults = [];
    for (const filePath of [...artifactPaths, ...pickupFiles]) {
      try {
        await fs.rm(filePath, { force: true });
        fileResults.push({ path: filePath, action: "removed" });
      } catch (error) {
        fileResults.push({ path: filePath, action: "failed", error: String(error?.message ?? error) });
      }
    }
    for (const filePath of logFiles) {
      try {
        if (/service\.(stdout|stderr)\.log$/i.test(path.basename(filePath))) {
          await fs.writeFile(filePath, "", "utf8");
          fileResults.push({ path: filePath, action: "truncated" });
        } else {
          await fs.rm(filePath, { force: true });
          fileResults.push({ path: filePath, action: "removed" });
        }
      } catch (error) {
        fileResults.push({ path: filePath, action: "failed", error: String(error?.message ?? error) });
      }
    }
    const failedFiles = fileResults.filter((item) => item.action === "failed");
    process.stdout.write(`${JSON.stringify({ ...result, applied: true, fileResults, failedFiles: failedFiles.length }, null, 2)}\n`);
    if (failedFiles.length) process.exitCode = 2;
  }
} finally {
  database.close();
}
