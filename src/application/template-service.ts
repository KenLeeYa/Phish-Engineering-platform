import crypto from "node:crypto";
import path from "node:path";
import PostalMime from "postal-mime";
import type { Email } from "postal-mime";
import {
  inspectAttachments,
  sanitizeTemplateContent,
  textAsSafeHtml,
} from "../domain/template-safety.js";
import {
  ContentConflictError,
  ContentNotFoundError,
  ContentStore,
  type TemplateVersionInput,
} from "../infrastructure/content-store.js";
import { AppError, type PublicUser } from "./platform-service.js";

const MAX_EML_BYTES = 10 * 1024 * 1024;

function recordFrom(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(400, "INVALID_INPUT", "輸入格式不正確。");
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string, minimum: number, maximum: number): string {
  if (typeof value !== "string") throw new AppError(400, "INVALID_INPUT", `${label}格式不正確。`);
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new AppError(400, "INVALID_INPUT", `${label}長度必須介於 ${minimum} 到 ${maximum} 個字元。`);
  }
  return normalized;
}

function optionalBody(value: unknown, label: string): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new AppError(400, "INVALID_INPUT", `${label}格式不正確。`);
  return value;
}

function safeSourceFileName(value: string): string {
  const withoutPath = path.posix.basename(path.win32.basename(value));
  return withoutPath
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_")
    .trim()
    .slice(0, 160) || "import.eml";
}

function fileStem(value: string): string {
  return value.replace(/\.eml$/i, "").trim().slice(0, 120) || "匯入郵件範本";
}

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export class TemplateService {
  constructor(private readonly store: ContentStore) {}

  listTemplates() {
    return this.store.listTemplates();
  }

  getTemplate(templateId: string) {
    try {
      return this.store.getTemplate(templateId);
    } catch (error) {
      if (error instanceof ContentNotFoundError) {
        throw new AppError(404, "TEMPLATE_NOT_FOUND", error.message);
      }
      throw error;
    }
  }

  createManual(user: PublicUser, input: unknown) {
    const record = recordFrom(input);
    const name = requiredText(record.name, "範本名稱", 2, 120);
    const subject = requiredText(record.subject, "郵件主旨", 1, 200);
    const htmlInput = optionalBody(record.htmlBody, "HTML 內容");
    const textInput = optionalBody(record.textBody, "純文字內容");
    if (!htmlInput.trim() && !textInput.trim()) {
      throw new AppError(400, "EMPTY_TEMPLATE", "HTML 與純文字內容不可同時空白。");
    }
    return this.store.createTemplate({
      id: crypto.randomUUID(),
      name,
      version: this.manualVersion(subject, htmlInput, textInput),
      userId: user.id,
      occurredAt: new Date().toISOString(),
    });
  }

  addManualVersion(user: PublicUser, templateId: string, input: unknown) {
    const record = recordFrom(input);
    const subject = requiredText(record.subject, "郵件主旨", 1, 200);
    const htmlInput = optionalBody(record.htmlBody, "HTML 內容");
    const textInput = optionalBody(record.textBody, "純文字內容");
    if (!htmlInput.trim() && !textInput.trim()) {
      throw new AppError(400, "EMPTY_TEMPLATE", "HTML 與純文字內容不可同時空白。");
    }
    try {
      return this.store.addTemplateVersion({
        templateId,
        version: this.manualVersion(subject, htmlInput, textInput),
        userId: user.id,
        occurredAt: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof ContentNotFoundError) {
        throw new AppError(404, "TEMPLATE_NOT_FOUND", error.message);
      }
      throw error;
    }
  }

  submitReview(user: PublicUser, templateId: string, input: unknown) {
    const record = recordFrom(input);
    const comment = typeof record.comment === "string" ? record.comment.trim().slice(0, 1_000) : "";
    try {
      return this.store.submitTemplateReview({
        reviewId: crypto.randomUUID(),
        templateId,
        userId: user.id,
        comment,
        occurredAt: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof ContentNotFoundError) {
        throw new AppError(404, "TEMPLATE_NOT_FOUND", error.message);
      }
      if (error instanceof ContentConflictError) {
        throw new AppError(409, "TEMPLATE_REVIEW_CONFLICT", error.message);
      }
      throw error;
    }
  }

  decideReview(user: PublicUser, templateId: string, reviewId: string, input: unknown) {
    const record = recordFrom(input);
    if (record.decision !== "approved" && record.decision !== "rejected") {
      throw new AppError(400, "INVALID_DECISION", "審核決定必須是 approved 或 rejected。");
    }
    const comment = typeof record.comment === "string" ? record.comment.trim().slice(0, 1_000) : "";
    if (record.decision === "rejected" && !comment) {
      throw new AppError(400, "COMMENT_REQUIRED", "退回範本時必須填寫原因。");
    }
    try {
      return this.store.decideTemplateReview({
        templateId,
        reviewId,
        reviewerId: user.id,
        decision: record.decision,
        comment,
        occurredAt: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof ContentNotFoundError) {
        throw new AppError(404, "REVIEW_NOT_FOUND", error.message);
      }
      if (error instanceof ContentConflictError) {
        throw new AppError(409, "TEMPLATE_REVIEW_CONFLICT", error.message);
      }
      throw error;
    }
  }

  async importEml(user: PublicUser, raw: Buffer, originalFileName: string) {
    if (!raw.length) throw new AppError(400, "EMPTY_EML", "EML 檔案內容為空。");
    if (raw.length > MAX_EML_BYTES) throw new AppError(413, "EML_TOO_LARGE", "EML 超過 10 MB 上限。");
    const sourceFileName = safeSourceFileName(originalFileName);
    if (!sourceFileName.toLowerCase().endsWith(".eml")) {
      throw new AppError(400, "INVALID_EML_EXTENSION", "只接受 .eml 郵件檔案。");
    }

    let email: Email;
    try {
      email = await PostalMime.parse(raw, {
        attachmentEncoding: "arraybuffer",
        maxHeadersSize: 512 * 1024,
        maxNestingDepth: 20,
        maxRfc822NestingDepth: 2,
        rfc822Attachments: true,
      });
    } catch {
      throw new AppError(400, "INVALID_EML", "EML MIME 結構無法解析。");
    }

    const subject = requiredText(email.subject || "無主旨", "郵件主旨", 1, 200);
    const sourceHtml = email.html || textAsSafeHtml(email.text || "");
    let sanitized;
    try {
      sanitized = sanitizeTemplateContent(sourceHtml, email.text || "");
    } catch (error) {
      throw new AppError(400, "UNSAFE_OR_EMPTY_TEMPLATE", (error as Error).message);
    }
    const attachments = inspectAttachments(email.attachments);
    const sanitization = {
      ...sanitized.summary,
      droppedHeaderCount: email.headers.length,
      recipientHeadersDropped: Boolean(email.to?.length || email.cc?.length || email.bcc?.length || email.deliveredTo),
      senderHeadersDropped: Boolean(email.from || email.sender || email.replyTo?.length || email.returnPath),
      acceptedAttachments: attachments.filter((attachment) => attachment.storageStatus === "approved").length,
      quarantinedAttachments: attachments.filter(
        (attachment) => attachment.storageStatus === "quarantined",
      ).length,
      rawMessageRetained: false,
    };

    return this.store.createTemplate({
      id: crypto.randomUUID(),
      name: (subject || fileStem(sourceFileName)).slice(0, 120),
      version: {
        id: crypto.randomUUID(),
        subject,
        htmlBody: sanitized.htmlBody,
        textBody: sanitized.textBody,
        sourceType: "eml_import",
        sourceFileName,
        sanitization,
        attachments,
      },
      userId: user.id,
      occurredAt: new Date().toISOString(),
    });
  }

  previewDocument(templateId: string): string {
    try {
      const preview = this.store.getTemplatePreview(templateId);
      return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(preview.subject)}</title>
  <style>
    body { margin: 0; padding: 24px; color: #17211d; background: #fff; font-family: Arial, "Microsoft JhengHei", sans-serif; }
    .preview-notice { margin: -24px -24px 22px; padding: 10px 14px; color: #285943; background: #e7f3eb; font-size: 12px; }
    a { pointer-events: none; cursor: default; }
    table { max-width: 100%; }
  </style>
</head>
<body>
  <div class="preview-notice">離線清理預覽：連結不可點擊，外部圖片與主動內容已移除。</div>
  ${preview.htmlBody}
</body>
</html>`;
    } catch (error) {
      if (error instanceof ContentNotFoundError) {
        throw new AppError(404, "TEMPLATE_NOT_FOUND", error.message);
      }
      throw error;
    }
  }

  private manualVersion(subject: string, htmlInput: string, textInput: string): TemplateVersionInput {
    const sourceHtml = htmlInput.trim() ? htmlInput : textAsSafeHtml(textInput);
    let sanitized;
    try {
      sanitized = sanitizeTemplateContent(sourceHtml, textInput);
    } catch (error) {
      throw new AppError(400, "UNSAFE_OR_EMPTY_TEMPLATE", (error as Error).message);
    }
    return {
      id: crypto.randomUUID(),
      subject,
      htmlBody: sanitized.htmlBody,
      textBody: sanitized.textBody,
      sourceType: "manual",
      sourceFileName: null,
      sanitization: { ...sanitized.summary, rawMessageRetained: false },
      attachments: [],
    };
  }
}
