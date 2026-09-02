import crypto from "node:crypto";
import sanitizeHtml from "sanitize-html";
import type { Attachment } from "postal-mime";

export const TRAINING_URL_PLACEHOLDER = "{{training_url}}";

const MAX_HTML_BYTES = 500 * 1024;
const MAX_TEXT_BYTES = 100 * 1024;
const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const MAX_ATTACHMENTS = 20;
const DANGEROUS_TAGS = new Set([
  "script",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
  "base",
  "style",
  "svg",
  "math",
  "video",
  "audio",
  "source",
]);

const COLOR = /^(?:#[0-9a-f]{3,8}|rgba?\([0-9.,%\s]+\)|[a-z]{3,20})$/i;
const LENGTH = /^(?:0|\d+(?:\.\d+)?(?:px|pt|em|rem|%))$/i;
const BOX = /^(?:0|\d+(?:\.\d+)?(?:px|pt|em|rem|%))(?:\s+(?:0|\d+(?:\.\d+)?(?:px|pt|em|rem|%))){0,3}$/i;

export interface SanitizationSummary {
  [key: string]: unknown;
  originalHtmlBytes: number;
  sanitizedHtmlBytes: number;
  externalLinksReplaced: number;
  linksRemoved: number;
  imageElementsRemoved: number;
  remoteImagesRemoved: number;
  inlineImagesRemoved: number;
  dangerousElementsRemoved: number;
}

export interface SanitizedTemplateContent {
  htmlBody: string;
  textBody: string;
  summary: SanitizationSummary;
}

export interface InspectedAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  disposition: string;
  storageStatus: "approved" | "quarantined";
  quarantineReason: string | null;
  content: Buffer | null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function plainTextFromHtml(value: string): string {
  const withBreaks = value
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|h[1-6])\s*>/gi, "\n");
  return sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeText(value: string): string {
  const cleaned = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/https?:\/\/[^\s<>"']+/gi, TRAINING_URL_PLACEHOLDER)
    .trim();
  if (Buffer.byteLength(cleaned, "utf8") > MAX_TEXT_BYTES) {
    throw new Error("純文字內容超過 100 KB 上限。");
  }
  return cleaned;
}

export function sanitizeTemplateContent(htmlInput: string, textInput = ""): SanitizedTemplateContent {
  if (Buffer.byteLength(htmlInput, "utf8") > MAX_HTML_BYTES) {
    throw new Error("HTML 內容超過 500 KB 上限。");
  }

  const summary: SanitizationSummary = {
    originalHtmlBytes: Buffer.byteLength(htmlInput, "utf8"),
    sanitizedHtmlBytes: 0,
    externalLinksReplaced: 0,
    linksRemoved: 0,
    imageElementsRemoved: 0,
    remoteImagesRemoved: 0,
    inlineImagesRemoved: 0,
    dangerousElementsRemoved: 0,
  };

  const htmlBody = sanitizeHtml(htmlInput, {
    allowedTags: [
      "p",
      "pre",
      "div",
      "span",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "h1",
      "h2",
      "h3",
      "h4",
      "ul",
      "ol",
      "li",
      "table",
      "thead",
      "tbody",
      "tfoot",
      "tr",
      "td",
      "th",
      "blockquote",
      "hr",
      "a",
    ],
    allowedAttributes: {
      "*": ["style"],
      a: ["href", "title"],
      table: ["align", "border", "cellpadding", "cellspacing", "width"],
      td: ["align", "colspan", "rowspan", "valign", "width"],
      th: ["align", "colspan", "rowspan", "valign", "width"],
    },
    allowedStyles: {
      "*": {
        color: [COLOR],
        "background-color": [COLOR],
        "font-family": [/^[a-z0-9 ,"'-]+$/i],
        "font-size": [LENGTH],
        "font-style": [/^(?:normal|italic)$/i],
        "font-weight": [/^(?:normal|bold|[1-9]00)$/i],
        "line-height": [/^(?:normal|\d+(?:\.\d+)?|\d+(?:\.\d+)?(?:px|pt|em|rem|%))$/i],
        "text-align": [/^(?:left|right|center|justify)$/i],
        "text-decoration": [/^(?:none|underline|line-through)$/i],
        display: [/^(?:block|inline|inline-block|table|table-row|table-cell)$/i],
        width: [LENGTH, /^auto$/i],
        "max-width": [LENGTH, /^none$/i],
        margin: [BOX],
        padding: [BOX],
        "white-space": [/^(?:normal|pre|pre-wrap)$/i],
      },
    },
    allowedSchemes: [],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    enforceHtmlBoundary: false,
    nestingLimit: 50,
    transformTags: {
      a: (_tagName, attributes) => {
        const href = attributes.href?.trim() ?? "";
        const transformed: Record<string, string> = {};
        if (href === TRAINING_URL_PLACEHOLDER || /^https?:\/\//i.test(href)) {
          transformed.href = TRAINING_URL_PLACEHOLDER;
          if (href !== TRAINING_URL_PLACEHOLDER) summary.externalLinksReplaced += 1;
        } else if (href) {
          summary.linksRemoved += 1;
        }
        if (attributes.title) transformed.title = attributes.title.slice(0, 200);
        return { tagName: "a", attribs: transformed };
      },
    },
    onOpenTag: (name, attributes) => {
      if (DANGEROUS_TAGS.has(name)) summary.dangerousElementsRemoved += 1;
      if (name === "img") {
        summary.imageElementsRemoved += 1;
        const source = attributes.src?.trim() ?? "";
        if (/^(?:https?:)?\/\//i.test(source)) summary.remoteImagesRemoved += 1;
        else summary.inlineImagesRemoved += 1;
      }
    },
  }).trim();
  summary.sanitizedHtmlBytes = Buffer.byteLength(htmlBody, "utf8");

  const textBody = sanitizeText(textInput || plainTextFromHtml(htmlBody));
  if (!plainTextFromHtml(htmlBody) && !textBody) {
    throw new Error("清理後的郵件內容是空白，請提供可見文字。");
  }
  return { htmlBody, textBody, summary };
}

function attachmentBuffer(attachment: Attachment): Buffer {
  if (typeof attachment.content === "string") {
    return Buffer.from(attachment.content, attachment.encoding === "base64" ? "base64" : "utf8");
  }
  if (attachment.content instanceof ArrayBuffer) return Buffer.from(attachment.content);
  return Buffer.from(
    attachment.content.buffer,
    attachment.content.byteOffset,
    attachment.content.byteLength,
  );
}

function sanitizedFileName(value: string | null, index: number): string {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_")
    .trim()
    .slice(0, 160);
  return normalized || `attachment-${index + 1}`;
}

function hasAllowedMagic(fileName: string, mimeType: string, content: Buffer): boolean {
  const extension = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")).toLowerCase() : "";
  if (extension === ".txt" && mimeType === "text/plain") return !content.includes(0);
  if (extension === ".png" && mimeType === "image/png") {
    return content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if ([".jpg", ".jpeg"].includes(extension) && mimeType === "image/jpeg") {
    return content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
  }
  if (extension === ".gif" && mimeType === "image/gif") {
    const header = content.subarray(0, 6).toString("ascii");
    return header === "GIF87a" || header === "GIF89a";
  }
  return false;
}

export function inspectAttachments(attachments: Attachment[]): InspectedAttachment[] {
  return attachments.map((attachment, index) => {
    const content = attachmentBuffer(attachment);
    const fileName = sanitizedFileName(attachment.filename, index);
    const mimeType = String(attachment.mimeType || "application/octet-stream").toLowerCase();
    let quarantineReason: string | null = null;
    if (index >= MAX_ATTACHMENTS) quarantineReason = "附件數量超過 20 筆限制";
    else if (!content.length) quarantineReason = "附件內容為空";
    else if (content.length > MAX_ATTACHMENT_BYTES) quarantineReason = "附件超過 2 MB 上限";
    else if (!hasAllowedMagic(fileName, mimeType, content)) {
      quarantineReason = "檔案類型或 magic bytes 不在安全 allowlist";
    }

    return {
      id: crypto.randomUUID(),
      fileName,
      mimeType,
      sizeBytes: content.length,
      sha256: crypto.createHash("sha256").update(content).digest("hex"),
      disposition: attachment.disposition ?? "attachment",
      storageStatus: quarantineReason ? "quarantined" : "approved",
      quarantineReason,
      content: quarantineReason ? null : content,
    };
  });
}

export function textAsSafeHtml(value: string): string {
  return `<pre style="white-space: pre-wrap; font-family: sans-serif">${escapeHtml(value)}</pre>`;
}
