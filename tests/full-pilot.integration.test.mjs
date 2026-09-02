import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import PostalMime from "postal-mime";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../dist/web/server.js";

const BOOTSTRAP_TOKEN = "full-pilot-integration-bootstrap-token";

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

function auth(cookies, csrf, contentType = "application/json") {
  return { cookie: cookies, "x-csrf-token": csrf, "content-type": contentType };
}

async function login(app, username, password) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { "content-type": "application/json" },
    payload: { username, password },
  });
  assert.equal(response.statusCode, 200, response.body);
  const cookies = cookieHeader(response);
  return { cookies, csrf: cookieValue(cookies, "sea_csrf") };
}

async function activateUser(app, username, initialPassword, newPassword) {
  const initial = await login(app, username, initialPassword);
  const changed = await app.inject({
    method: "POST",
    url: "/api/auth/password",
    headers: auth(initial.cookies, initial.csrf),
    payload: { currentPassword: initialPassword, newPassword },
  });
  assert.equal(changed.statusCode, 204, changed.body);
  return login(app, username, newPassword);
}

const TEMPLATE_EML = Buffer.from([
  "From: Awareness <awareness@awareness.customer.example>",
  "To: Test User <awareness-test@customer.example>",
  "Subject: Internal policy confirmation",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="pilot-boundary"',
  "",
  "--pilot-boundary",
  'Content-Type: text/html; charset="utf-8"',
  "Content-Transfer-Encoding: 8bit",
  "",
  '<p>您好 {{recipient_name}}，請<a href="https://vendor.invalid/action">確認說明</a>。</p>',
  "--pilot-boundary",
  'Content-Type: text/plain; name="readme.txt"',
  'Content-Disposition: attachment; filename="readme.txt"',
  "Content-Transfer-Encoding: base64",
  "",
  "5a6J5YWo5o+Q6YaS77ya6KuL5Yu/5o+Q5L6b5a+G56K844CCT1RQ44CC",
  "--pilot-boundary--",
  "",
].join("\r\n"), "utf8");

test("full local pilot enforces maker-checker and produces tracked pickup reports", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "local-awareness-full-"));
  const pickupDirectory = path.join(directory, "pickup");
  const reportDirectory = path.join(directory, "reports");
  const databasePath = path.join(directory, "platform.sqlite");
  const app = await createApp({
    databasePath,
    allowedAdminHosts: ["localhost"],
    allowedTrackingOrigins: ["http://localhost"],
    bootstrapToken: BOOTSTRAP_TOKEN,
    pickupDirectory,
    reportDirectory,
    secretVaultPath: path.join(directory, "secrets.vault.json"),
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
    payload: {
      organizationName: "客戶測試公司",
      displayName: "活動建立者",
      username: "admin",
      password: "Safety-River-2026!",
    },
  });
  assert.equal(setup.statusCode, 201, setup.body);
  const adminCookies = cookieHeader(setup);
  const adminCsrf = cookieValue(adminCookies, "sea_csrf");

  const settings = await app.inject({
    method: "PATCH",
    url: "/api/settings",
    headers: auth(adminCookies, adminCsrf),
    payload: {
      recipientDomains: ["customer.example"],
      senderDomains: ["awareness.customer.example"],
      testRecipientEmails: ["awareness-test@customer.example"],
    },
  });
  assert.equal(settings.statusCode, 200, settings.body);

  const user = await app.inject({
    method: "POST",
    url: "/api/users",
    headers: auth(adminCookies, adminCsrf),
    payload: {
      username: "reviewer",
      displayName: "獨立審核人",
      role: "reviewer",
      password: "Review-Safety-2026!",
    },
  });
  assert.equal(user.statusCode, 201, user.body);
  const reviewer = await activateUser(app, "reviewer", "Review-Safety-2026!", "Review-Changed-2026!");
  const evidenceUser = await app.inject({
    method: "POST",
    url: "/api/users",
    headers: auth(adminCookies, adminCsrf),
    payload: {
      username: "evidence-admin",
      displayName: "Evidence Administrator",
      role: "system_admin",
      password: "Evidence-Initial-2026!",
    },
  });
  assert.equal(evidenceUser.statusCode, 201, evidenceUser.body);
  const evidenceAdmin = await activateUser(
    app,
    "evidence-admin",
    "Evidence-Initial-2026!",
    "Evidence-Changed-2026!",
  );

  const group = await app.inject({
    method: "POST",
    url: "/api/recipient-groups",
    headers: auth(adminCookies, adminCsrf),
    payload: { name: "Pilot test mailbox", description: "Only the allowlisted mailbox" },
  });
  assert.equal(group.statusCode, 201, group.body);
  const groupId = group.json().group.id;
  const roster = await app.inject({
    method: "POST",
    url: `/api/recipient-groups/${groupId}/import-csv`,
    headers: auth(adminCookies, adminCsrf),
    payload: { csvText: "姓名,E-mail,部門,部群\n測試人員,awareness-test@customer.example,資訊安全部,管理處" },
  });
  assert.equal(roster.statusCode, 200, roster.body);

  const templateResponse = await app.inject({
    method: "POST",
    url: "/api/templates/import-eml?fileName=pilot.eml",
    headers: auth(adminCookies, adminCsrf, "message/rfc822"),
    payload: TEMPLATE_EML,
  });
  assert.equal(templateResponse.statusCode, 201, templateResponse.body);
  const template = templateResponse.json().template;
  assert.equal(template.attachments[0].storageStatus, "approved");
  const requestTemplateReview = await app.inject({
    method: "POST",
    url: `/api/templates/${template.id}/review-requests`,
    headers: auth(adminCookies, adminCsrf),
    payload: { comment: "Ready for independent review" },
  });
  assert.equal(requestTemplateReview.statusCode, 201, requestTemplateReview.body);
  const templateReviewId = requestTemplateReview.json().template.reviews[0].id;

  const selfApproval = await app.inject({
    method: "POST",
    url: `/api/templates/${template.id}/reviews/${templateReviewId}/decision`,
    headers: auth(adminCookies, adminCsrf),
    payload: { decision: "approved", comment: "self" },
  });
  assert.equal(selfApproval.statusCode, 409, selfApproval.body);
  const templateApproval = await app.inject({
    method: "POST",
    url: `/api/templates/${template.id}/reviews/${templateReviewId}/decision`,
    headers: auth(reviewer.cookies, reviewer.csrf),
    payload: { decision: "approved", comment: "Approved for test mailbox" },
  });
  assert.equal(templateApproval.statusCode, 200, templateApproval.body);

  const connectorResponse = await app.inject({
    method: "POST",
    url: "/api/connectors",
    headers: auth(adminCookies, adminCsrf),
    payload: {
      name: "Local pickup",
      connectorType: "pickup",
      senderEmail: "training@awareness.customer.example",
      senderName: "Security Awareness",
    },
  });
  assert.equal(connectorResponse.statusCode, 201, connectorResponse.body);
  const connectorId = connectorResponse.json().connector.id;
  const verify = await app.inject({
    method: "POST",
    url: `/api/connectors/${connectorId}/verify`,
    headers: auth(adminCookies, adminCsrf),
    payload: { testRecipientEmail: "awareness-test@customer.example" },
  });
  assert.equal(verify.statusCode, 200, verify.body);

  const foreignTrackingOrigin = await app.inject({
    method: "POST",
    url: "/api/campaigns",
    headers: auth(adminCookies, adminCsrf),
    payload: {
      name: "Foreign tracking origin must fail",
      templateId: template.id,
      recipientGroupId: groupId,
      connectorId,
      baseUrl: "https://attacker.example",
      sendWindowStart: "00:00",
      sendWindowEnd: "23:59",
      throttlePerMinute: 60,
      testOnly: true,
    },
  });
  assert.equal(foreignTrackingOrigin.statusCode, 409, foreignTrackingOrigin.body);
  assert.equal(foreignTrackingOrigin.json().error.code, "TRACKING_ORIGIN_NOT_ALLOWED");

  const campaignResponse = await app.inject({
    method: "POST",
    url: "/api/campaigns",
    headers: auth(adminCookies, adminCsrf),
    payload: {
      name: "Full local pilot",
      templateId: template.id,
      recipientGroupId: groupId,
      connectorId,
      baseUrl: "http://localhost",
      sendWindowStart: "00:00",
      sendWindowEnd: "23:59",
      throttlePerMinute: 60,
      testOnly: true,
    },
  });
  assert.equal(campaignResponse.statusCode, 201, campaignResponse.body);
  const campaignId = campaignResponse.json().campaign.id;
  const campaignReview = await app.inject({
    method: "POST",
    url: `/api/campaigns/${campaignId}/review-requests`,
    headers: auth(adminCookies, adminCsrf),
    payload: { comment: "Test-only campaign" },
  });
  assert.equal(campaignReview.statusCode, 201, campaignReview.body);
  const campaignReviewId = campaignReview.json().campaign.reviews[0].id;
  const campaignApproval = await app.inject({
    method: "POST",
    url: `/api/campaigns/${campaignId}/reviews/${campaignReviewId}/decision`,
    headers: auth(reviewer.cookies, reviewer.csrf),
    payload: { decision: "approved", comment: "Scope verified" },
  });
  assert.equal(campaignApproval.statusCode, 200, campaignApproval.body);
  assert.equal(campaignApproval.json().campaign.reviews[0].recipientCount, 1);
  assert.match(campaignApproval.json().campaign.reviews[0].approvalDigest, /^[a-f0-9]{64}$/);
  const mutableRoster = await app.inject({
    method: "POST",
    url: `/api/recipient-groups/${groupId}/import-csv`,
    headers: auth(adminCookies, adminCsrf),
    payload: { csvText: "姓名,E-mail,部門,部群\n已變更名稱,awareness-test@customer.example,變更後部門,變更後部群" },
  });
  assert.equal(mutableRoster.statusCode, 200, mutableRoster.body);
  const schedule = await app.inject({
    method: "POST",
    url: `/api/campaigns/${campaignId}/schedule`,
    headers: auth(adminCookies, adminCsrf),
    payload: {},
  });
  assert.equal(schedule.statusCode, 200, schedule.body);
  const process = await app.inject({
    method: "POST",
    url: "/api/delivery/process",
    headers: { cookie: adminCookies, "x-csrf-token": adminCsrf },
  });
  assert.equal(process.statusCode, 200, process.body);
  assert.equal(process.json().sent, 1);

  const pickupFiles = (await fs.readdir(pickupDirectory)).sort();
  assert.equal(pickupFiles.length, 2);
  const sentRaw = await fs.readFile(path.join(pickupDirectory, pickupFiles.at(-1)));
  const sentMail = await PostalMime.parse(sentRaw);
  const clickMatch = sentMail.html.match(/\/t\/c\/([A-Za-z0-9_-]+)/);
  assert.ok(clickMatch, sentMail.html);
  const token = clickMatch[1];
  assert.match(sentMail.html, /測試人員/);
  assert.doesNotMatch(sentMail.html, /已變更名稱/);

  const afterSendDatabase = new DatabaseSync(databasePath);
  const storedTarget = afterSendDatabase.prepare(`
    SELECT tracking_token, tracking_token_hash, display_name_snapshot
    FROM campaign_targets WHERE campaign_id = ?
  `).get(campaignId);
  assert.equal(storedTarget.tracking_token, "");
  assert.match(storedTarget.tracking_token_hash, /^[a-f0-9]{64}$/);
  assert.equal(storedTarget.display_name_snapshot, "測試人員");
  afterSendDatabase.close();

  const open = await app.inject({ method: "GET", url: `/t/o/${token}.gif`, headers: { "user-agent": "Mozilla/5.0" } });
  assert.equal(open.statusCode, 200);
  assert.equal(open.headers["content-type"], "image/gif");
  const duplicateOpen = await app.inject({ method: "GET", url: `/t/o/${token}.gif`, headers: { "user-agent": "Mozilla/5.0" } });
  assert.equal(duplicateOpen.statusCode, 200);
  const click = await app.inject({ method: "GET", url: `/t/c/${token}`, headers: { "user-agent": "Mozilla/5.0" } });
  assert.equal(click.statusCode, 302);
  const training = await app.inject({ method: "GET", url: click.headers.location, headers: { "user-agent": "Mozilla/5.0" } });
  assert.equal(training.statusCode, 200);
  assert.equal(training.body.includes("密碼、OTP、Token"), true);
  const acknowledgement = await app.inject({
    method: "POST",
    url: `/training/${token}/ack`,
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "Mozilla/5.0" },
    payload: "",
  });
  assert.equal(acknowledgement.statusCode, 200, acknowledgement.body);
  const controlledAttachment = await app.inject({
    method: "GET",
    url: `/t/a/${token}/${template.attachments[0].id}`,
    headers: { "user-agent": "Mozilla/5.0" },
  });
  assert.equal(controlledAttachment.statusCode, 200, controlledAttachment.body);

  const creatorEvidence = await app.inject({
    method: "POST",
    url: `/api/campaigns/${campaignId}/audit-events`,
    headers: auth(adminCookies, adminCsrf),
    payload: {
      sourceDigest: "a".repeat(64),
      sourceReference: "gateway-export-creator",
      events: [{
        sourceEventId: "creator-event-1",
        email: "awareness-test@customer.example",
        eventType: "attachment_opened",
        attachmentId: template.attachments[0].id,
        occurredAt: new Date().toISOString(),
      }],
    },
  });
  assert.equal(creatorEvidence.statusCode, 409, creatorEvidence.body);
  const reviewerEvidence = await app.inject({
    method: "POST",
    url: `/api/campaigns/${campaignId}/audit-events`,
    headers: auth(reviewer.cookies, reviewer.csrf),
    payload: { sourceDigest: "b".repeat(64), sourceReference: "gateway-export-reviewer", events: [] },
  });
  assert.equal(reviewerEvidence.statusCode, 403, reviewerEvidence.body);
  const evidencePayload = {
    sourceDigest: "c".repeat(64),
    sourceReference: "gateway-export-approved",
    events: [{
      sourceEventId: "gateway-event-1",
      email: "awareness-test@customer.example",
      eventType: "attachment_opened",
      attachmentId: template.attachments[0].id,
      occurredAt: new Date().toISOString(),
    }],
  };
  const evidence = await app.inject({
    method: "POST",
    url: `/api/campaigns/${campaignId}/audit-events`,
    headers: auth(evidenceAdmin.cookies, evidenceAdmin.csrf),
    payload: evidencePayload,
  });
  assert.equal(evidence.statusCode, 200, evidence.body);
  assert.deepEqual(evidence.json(), { imported: 1, skipped: 0 });
  const replayedEvidence = await app.inject({
    method: "POST",
    url: `/api/campaigns/${campaignId}/audit-events`,
    headers: auth(evidenceAdmin.cookies, evidenceAdmin.csrf),
    payload: evidencePayload,
  });
  assert.deepEqual(replayedEvidence.json(), { imported: 0, skipped: 1 });

  const eventDatabase = new DatabaseSync(databasePath);
  const openCount = eventDatabase.prepare(`
    SELECT COUNT(*) AS count FROM simulation_events e
    JOIN campaign_targets ct ON ct.id = e.campaign_target_id
    WHERE ct.campaign_id = ? AND e.event_type = 'email_opened'
  `).get(campaignId).count;
  assert.equal(openCount, 1);
  eventDatabase.close();

  const detail = await app.inject({ method: "GET", url: `/api/campaigns/${campaignId}`, headers: { cookie: adminCookies } });
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(detail.json().campaign.status, "completed");
  assert.equal(detail.json().campaign.metrics.uniqueClicked, 1);
  assert.equal(detail.json().campaign.metrics.uniqueAttachmentOpened, 1);
  assert.equal(detail.json().campaign.metrics.uniqueTrainingAcknowledged, 1);

  const report = await app.inject({
    method: "POST",
    url: `/api/campaigns/${campaignId}/reports`,
    headers: { cookie: adminCookies, "x-csrf-token": adminCsrf },
  });
  assert.equal(report.statusCode, 201, report.body);
  assert.equal(report.json().artifacts.length, 3);
  for (const artifact of report.json().artifacts) {
    const download = await app.inject({
      method: "GET",
      url: `/api/report-artifacts/${artifact.id}/download`,
      headers: { cookie: adminCookies },
    });
    assert.equal(download.statusCode, 200, download.body);
    assert.equal(download.headers["x-content-sha256"], artifact.sha256);
    assert.ok(download.rawPayload.length > 100);
    if (artifact.format === "xlsx" || artifact.format === "docx") {
      assert.equal(download.rawPayload.subarray(0, 2).toString("ascii"), "PK");
    }
  }

  const audit = await app.inject({ method: "GET", url: "/api/audit/export", headers: { cookie: adminCookies } });
  assert.equal(audit.statusCode, 200, audit.body);
  assert.match(audit.json().finalHash, /^[a-f0-9]{64}$/);
  assert.ok(audit.json().records.length > 10);
  assert.equal(audit.json().complete, true);

  const staleScopeCampaign = await app.inject({
    method: "POST",
    url: "/api/campaigns",
    headers: auth(adminCookies, adminCsrf),
    payload: {
      name: "Revoked scope campaign",
      templateId: template.id,
      recipientGroupId: groupId,
      connectorId,
      baseUrl: "http://localhost",
      sendWindowStart: "00:00",
      sendWindowEnd: "23:59",
      throttlePerMinute: 60,
      testOnly: true,
    },
  });
  assert.equal(staleScopeCampaign.statusCode, 201, staleScopeCampaign.body);
  const staleCampaignId = staleScopeCampaign.json().campaign.id;
  const staleReview = await app.inject({
    method: "POST",
    url: `/api/campaigns/${staleCampaignId}/review-requests`,
    headers: auth(adminCookies, adminCsrf),
    payload: { comment: "Will revoke scope after approval" },
  });
  const staleReviewId = staleReview.json().campaign.reviews[0].id;
  const staleApproval = await app.inject({
    method: "POST",
    url: `/api/campaigns/${staleCampaignId}/reviews/${staleReviewId}/decision`,
    headers: auth(reviewer.cookies, reviewer.csrf),
    payload: { decision: "approved", comment: "Approved before scope change" },
  });
  assert.equal(staleApproval.statusCode, 200, staleApproval.body);
  const staleSchedule = await app.inject({
    method: "POST",
    url: `/api/campaigns/${staleCampaignId}/schedule`,
    headers: auth(adminCookies, adminCsrf),
    payload: {},
  });
  assert.equal(staleSchedule.statusCode, 200, staleSchedule.body);
  const tokenDatabase = new DatabaseSync(databasePath);
  const staleToken = tokenDatabase.prepare("SELECT tracking_token FROM campaign_targets WHERE campaign_id = ?").get(staleCampaignId).tracking_token;
  tokenDatabase.close();
  const revokeScope = await app.inject({
    method: "PATCH",
    url: "/api/settings",
    headers: auth(adminCookies, adminCsrf),
    payload: { testRecipientEmails: [] },
  });
  assert.equal(revokeScope.statusCode, 200, revokeScope.body);
  const rejectedProcess = await app.inject({
    method: "POST",
    url: "/api/delivery/process",
    headers: { cookie: adminCookies, "x-csrf-token": adminCsrf },
  });
  assert.equal(rejectedProcess.statusCode, 200, rejectedProcess.body);
  assert.equal(rejectedProcess.json().failed, 1);
  const rejectedToken = await app.inject({ method: "GET", url: `/t/c/${staleToken}` });
  assert.equal(rejectedToken.statusCode, 404, rejectedToken.body);
});
