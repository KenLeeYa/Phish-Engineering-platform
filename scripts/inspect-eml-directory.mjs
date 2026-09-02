import fs from "node:fs/promises";
import path from "node:path";
import PostalMime from "postal-mime";
import {
  inspectAttachments,
  sanitizeTemplateContent,
  textAsSafeHtml,
} from "../dist/domain/template-safety.js";

const directory = process.argv[2];
if (!directory) {
  console.error("用法：npm run inspect:eml -- <EML 目錄>");
  process.exitCode = 2;
} else {
  const entries = (await fs.readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".eml"))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-Hant"));
  const results = [];
  let failed = false;

  for (const entry of entries) {
    try {
      const email = await PostalMime.parse(await fs.readFile(path.join(directory, entry.name)), {
        attachmentEncoding: "arraybuffer",
        maxHeadersSize: 512 * 1024,
        maxNestingDepth: 20,
        maxRfc822NestingDepth: 2,
        rfc822Attachments: true,
      });
      const sanitized = sanitizeTemplateContent(
        email.html || textAsSafeHtml(email.text || ""),
        email.text || "",
      );
      const attachments = inspectAttachments(email.attachments);
      const activeContentRemaining = /<(?:script|form|input|iframe|object|embed|img)\b/i.test(
        sanitized.htmlBody,
      );
      const liveResourceRemaining = /(?:href|src)\s*=\s*["'](?:https?:)?\/\//i.test(
        sanitized.htmlBody,
      );
      if (activeContentRemaining || liveResourceRemaining) failed = true;
      results.push({
        file: entry.name,
        status: activeContentRemaining || liveResourceRemaining ? "FAIL" : "PASS",
        linksReplaced: sanitized.summary.externalLinksReplaced,
        imagesRemoved: sanitized.summary.imageElementsRemoved,
        activeElementsRemoved: sanitized.summary.dangerousElementsRemoved,
        retainedAttachments: attachments.filter((item) => item.storageStatus === "approved").length,
        quarantinedAttachments: attachments.filter((item) => item.storageStatus === "quarantined").length,
        droppedHeaders: email.headers.length,
      });
    } catch (error) {
      failed = true;
      results.push({ file: entry.name, status: "ERROR", error: error.message });
    }
  }

  console.table(results);
  console.log(`檢查 ${results.length} 封 EML；原始郵件、地址與標頭值均未寫入磁碟。`);
  if (failed) process.exitCode = 1;
}
