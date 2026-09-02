import assert from "node:assert/strict";
import test from "node:test";
import {
  TRAINING_URL_PLACEHOLDER,
  inspectAttachments,
  sanitizeTemplateContent,
} from "../dist/domain/template-safety.js";

test("template sanitizer removes active content and rewrites live links", () => {
  const result = sanitizeTemplateContent(`
    <style>@import url(https://tracker.example/style.css)</style>
    <script>fetch('https://tracker.example')</script>
    <form action="https://tracker.example/submit"><input name="password"></form>
    <p style="color: #123456; background-image: url(https://tracker.example/bg.png)">
      <a href="https://tracker.example/click">請確認</a>
      <img src="https://tracker.example/pixel.png">
    </p>
  `);

  assert.equal(result.htmlBody.includes("<script"), false);
  assert.equal(result.htmlBody.includes("<form"), false);
  assert.equal(result.htmlBody.includes("<input"), false);
  assert.equal(result.htmlBody.includes("<img"), false);
  assert.equal(result.htmlBody.includes("background-image"), false);
  assert.equal(result.htmlBody.includes(TRAINING_URL_PLACEHOLDER), true);
  assert.equal(result.summary.externalLinksReplaced, 1);
  assert.equal(result.summary.remoteImagesRemoved, 1);
  assert.ok(result.summary.dangerousElementsRemoved >= 4);
});

test("attachment filter retains passive files and quarantines macro documents", () => {
  const attachments = inspectAttachments([
    {
      filename: "notice.txt",
      mimeType: "text/plain",
      disposition: "attachment",
      content: new TextEncoder().encode("safe text"),
    },
    {
      filename: "payload.docm",
      mimeType: "application/vnd.ms-word.document.macroEnabled.12",
      disposition: "attachment",
      content: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    },
  ]);

  assert.equal(attachments[0].storageStatus, "approved");
  assert.ok(attachments[0].content);
  assert.equal(attachments[1].storageStatus, "quarantined");
  assert.equal(attachments[1].content, null);
});
