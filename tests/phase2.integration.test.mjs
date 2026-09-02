import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../dist/web/server.js";

const BOOTSTRAP_TOKEN = "phase2-integration-bootstrap-token";

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

function authenticatedHeaders(cookies, csrf, contentType = "application/json") {
  return { cookie: cookies, "x-csrf-token": csrf, "content-type": contentType };
}

const TEST_EML = Buffer.from(
  [
    "From: Vendor Example <vendor@example.net>",
    "To: Employee <employee@customer.example>",
    "Subject: Account review notice",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="phase2-boundary"',
    "",
    "--phase2-boundary",
    'Content-Type: text/html; charset="utf-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    '<html><body><script>alert(1)</script><form action="https://tracker.example/submit"><input name="password"></form><p><a href="https://tracker.example/click">Review</a><img src="https://tracker.example/pixel.png"></p></body></html>',
    "--phase2-boundary",
    'Content-Type: text/plain; name="notice.txt"',
    'Content-Disposition: attachment; filename="notice.txt"',
    "Content-Transfer-Encoding: base64",
    "",
    "c2FmZSB0ZXh0",
    "--phase2-boundary",
    'Content-Type: application/vnd.ms-word.document.macroEnabled.12; name="payload.docm"',
    'Content-Disposition: attachment; filename="payload.docm"',
    "Content-Transfer-Encoding: base64",
    "",
    "UEsDBA==",
    "--phase2-boundary--",
    "",
  ].join("\r\n"),
  "utf8",
);

test("Phase 2A imports scoped recipients and quarantines unsafe EML content", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "local-awareness-phase2-"));
  const app = await createApp({
    databasePath: path.join(directory, "platform.sqlite"),
    allowedAdminHosts: ["localhost"],
    allowedTrackingOrigins: ["http://localhost"],
    bootstrapToken: BOOTSTRAP_TOKEN,
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
      displayName: "安全管理員",
      username: "admin",
      password: "Safety-River-2026!",
    },
  });
  assert.equal(setup.statusCode, 201, setup.body);
  const cookies = cookieHeader(setup);
  const csrf = cookieValue(cookies, "sea_csrf");

  const settings = await app.inject({
    method: "PATCH",
    url: "/api/settings",
    headers: authenticatedHeaders(cookies, csrf),
    payload: { recipientDomains: ["customer.example"] },
  });
  assert.equal(settings.statusCode, 200, settings.body);

  const groupResponse = await app.inject({
    method: "POST",
    url: "/api/recipient-groups",
    headers: authenticatedHeaders(cookies, csrf),
    payload: { name: "2026 Q3 測試名單", description: "僅限測試帳號" },
  });
  assert.equal(groupResponse.statusCode, 201, groupResponse.body);
  const groupId = groupResponse.json().group.id;

  const rosterResponse = await app.inject({
    method: "POST",
    url: `/api/recipient-groups/${groupId}/import-csv`,
    headers: authenticatedHeaders(cookies, csrf),
    payload: {
      csvText: [
        "姓名,E-mail,部門,部群",
        "王小明,user1@customer.example,資訊部,管理處",
        "王小明二,user1@customer.example,資訊部,管理處",
        "林小華,user2@customer.example,人資部,管理處",
        "外部人員,outside@example.net,外部,外部",
      ].join("\n"),
    },
  });
  assert.equal(rosterResponse.statusCode, 200, rosterResponse.body);
  assert.equal(rosterResponse.json().acceptedRows, 2);
  assert.equal(rosterResponse.json().skippedRows, 1);
  assert.equal(rosterResponse.json().duplicateRows, 1);
  assert.equal(rosterResponse.json().group.recipientCount, 2);

  const emlResponse = await app.inject({
    method: "POST",
    url: "/api/templates/import-eml?fileName=sample.eml",
    headers: authenticatedHeaders(cookies, csrf, "message/rfc822"),
    payload: TEST_EML,
  });
  assert.equal(emlResponse.statusCode, 201, emlResponse.body);
  const template = emlResponse.json().template;
  assert.equal(template.latestVersion, 1);
  assert.equal(template.sanitization.externalLinksReplaced, 1);
  assert.equal(template.sanitization.remoteImagesRemoved, 1);
  assert.equal(template.sanitization.recipientHeadersDropped, true);
  assert.equal(template.sanitization.rawMessageRetained, false);
  assert.equal(template.attachments.length, 2);
  assert.equal(template.attachments.find((item) => item.fileName === "notice.txt").storageStatus, "approved");
  assert.equal(template.attachments.find((item) => item.fileName === "payload.docm").storageStatus, "quarantined");

  const preview = await app.inject({
    method: "GET",
    url: `/api/templates/${template.id}/preview`,
    headers: { cookie: cookies },
  });
  assert.equal(preview.statusCode, 200, preview.body);
  assert.equal(preview.body.includes("<script"), false);
  assert.equal(preview.body.includes("<form"), false);
  assert.equal(preview.body.includes("<img"), false);
  assert.equal(preview.body.includes('href="https://'), false);
  assert.match(preview.headers["content-security-policy"], /default-src 'none'/);
  assert.equal(preview.headers["x-frame-options"], "SAMEORIGIN");

  const newVersion = await app.inject({
    method: "POST",
    url: `/api/templates/${template.id}/versions`,
    headers: authenticatedHeaders(cookies, csrf),
    payload: {
      subject: "Account review notice v2",
      htmlBody: '<p><a href="https://outside.example">Updated review</a></p>',
      textBody: "Updated review https://outside.example",
    },
  });
  assert.equal(newVersion.statusCode, 201, newVersion.body);
  assert.equal(newVersion.json().template.latestVersion, 2);
  assert.equal(newVersion.json().template.sourceType, "manual");
});
