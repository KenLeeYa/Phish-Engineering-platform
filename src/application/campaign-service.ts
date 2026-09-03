import crypto from "node:crypto";
import type { PlatformSettings } from "../domain/settings.js";
import { hashToken } from "../domain/security.js";
import {
  SaaSQuotaExceededError,
  assertQuotaAvailable,
  type RuntimeLimits,
} from "../domain/saas.js";
import {
  CampaignConflictError,
  CampaignNotFoundError,
  CampaignStore,
  type CampaignDetail,
  type CampaignRecipientSnapshot,
  type SimulationEventType,
  type StoredConnector,
} from "../infrastructure/campaign-store.js";
import { MailTransport } from "../infrastructure/mail-transport.js";
import { SecretVault, SecretVaultUnavailableError } from "../infrastructure/secret-vault.js";
import { AppError, type PublicUser } from "./platform-service.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOST_PATTERN = /^(?:[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?|\[[0-9a-f:]+\])$/i;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function recordFrom(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(400, "INVALID_INPUT", "輸入格式不正確。");
  }
  return value as Record<string, unknown>;
}

function textField(value: unknown, label: string, minimum: number, maximum: number): string {
  if (typeof value !== "string") throw new AppError(400, "INVALID_INPUT", `${label}格式不正確。`);
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new AppError(400, "INVALID_INPUT", `${label}長度必須介於 ${minimum} 到 ${maximum} 個字元。`);
  }
  return normalized;
}

function normalizedEmail(value: unknown, label: string): string {
  const email = textField(value, label, 5, 254).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new AppError(400, "INVALID_EMAIL", `${label}格式不正確。`);
  return email;
}

function validateBaseUrl(value: unknown, allowedOrigins: ReadonlySet<string>): string {
  const input = textField(value, "追蹤基底網址", 8, 300);
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AppError(400, "INVALID_BASE_URL", "追蹤基底網址格式不正確。");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new AppError(400, "INVALID_BASE_URL", "追蹤基底網址只能包含 scheme、主機與連接埠。");
  }
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if ((!loopback && url.protocol !== "https:") || (loopback && !["http:", "https:"].includes(url.protocol))) {
    throw new AppError(400, "HTTPS_REQUIRED", "非本機追蹤網址必須使用 HTTPS。");
  }
  if (!allowedOrigins.has(url.origin)) {
    throw new AppError(409, "TRACKING_ORIGIN_NOT_ALLOWED", "追蹤基底網址不在部署核准的精確 Origin 清單內。");
  }
  return url.origin;
}

function isoTimestamp(value: unknown, label: string, fallbackNow = false): string {
  if (fallbackNow && (value === undefined || value === null || value === "")) {
    return new Date().toISOString();
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError(400, "INVALID_TIMESTAMP", `${label}格式不正確。`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new AppError(400, "INVALID_TIMESTAMP", `${label}格式不正確。`);
  }
  return new Date(milliseconds).toISOString();
}

function withinSendWindow(now: Date, timezone: string, start: string, end: string): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const current = hour * 60 + minute;
  const [startHour = 0, startMinute = 0] = start.split(":").map(Number);
  const [endHour = 0, endMinute = 0] = end.split(":").map(Number);
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;
  return startMinutes <= endMinutes
    ? current >= startMinutes && current <= endMinutes
    : current >= startMinutes || current <= endMinutes;
}

function publicConnector(connector: StoredConnector, includeConfig: boolean) {
  const { secretRef, config, ...rest } = connector;
  return {
    ...rest,
    ...(includeConfig ? { config } : {}),
    secretConfigured: Boolean(secretRef),
  };
}

function campaignApprovalDigest(campaign: CampaignDetail, recipients: CampaignRecipientSnapshot[]): string {
  return crypto.createHash("sha256").update(JSON.stringify({
    campaignId: campaign.id,
    templateId: campaign.templateId,
    recipientGroupId: campaign.recipientGroupId,
    connectorId: campaign.connectorId,
    baseUrl: campaign.baseUrl,
    sendWindowStart: campaign.sendWindowStart,
    sendWindowEnd: campaign.sendWindowEnd,
    throttlePerMinute: campaign.throttlePerMinute,
    testOnly: campaign.testOnly,
    recipients: recipients.map((recipient) => ({
      id: recipient.id,
      email: recipient.email.toLowerCase(),
      displayName: recipient.displayName,
      department: recipient.department,
      businessUnit: recipient.businessUnit,
    })),
  })).digest("hex");
}

export class CampaignService {
  private processing = false;

  constructor(
    private readonly store: CampaignStore,
    private readonly platformStore: {
      getDeliveryControl(): { emergencyStop: boolean };
    },
    private readonly getSettings: () => PlatformSettings,
    private readonly vault: SecretVault,
    private readonly mail: MailTransport,
    private readonly allowedTrackingOrigins: ReadonlySet<string>,
    private readonly limits: RuntimeLimits,
  ) {}

  listConnectors(includeConfig = false) {
    return this.store.listConnectors().map((connector) => publicConnector(connector, includeConfig));
  }

  async createConnector(user: PublicUser, input: unknown) {
    const record = recordFrom(input);
    const name = textField(record.name, "連接器名稱", 2, 100);
    const senderEmail = normalizedEmail(record.senderEmail, "寄件 Email");
    const senderName = textField(record.senderName, "寄件顯示名稱", 2, 120);
    const senderDomain = senderEmail.slice(senderEmail.lastIndexOf("@") + 1);
    if (!this.getSettings().scope.senderDomains.includes(senderDomain)) {
      throw new AppError(409, "SENDER_SCOPE_REQUIRED", "寄件 Email 不在核准寄件網域內。");
    }
    if (record.connectorType !== "pickup" && record.connectorType !== "smtp") {
      throw new AppError(400, "INVALID_CONNECTOR", "連接器類型只支援 pickup 或 smtp。");
    }

    let config: Record<string, unknown>;
    let secretRef: string | null = null;
    if (record.connectorType === "pickup") {
      config = { mode: "local_eml_pickup" };
    } else {
      const host = textField(record.host, "SMTP Host", 1, 253);
      if (!HOST_PATTERN.test(host)) throw new AppError(400, "INVALID_SMTP_HOST", "SMTP Host 格式不正確。");
      const port = Number(record.port);
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new AppError(400, "INVALID_SMTP_PORT", "SMTP Port 必須是 1 到 65535 的整數。");
      }
      if (typeof record.secure !== "boolean") {
        throw new AppError(400, "INVALID_SMTP_TLS", "secure 必須是布林值；false 時仍強制 STARTTLS。");
      }
      const username = typeof record.username === "string" ? record.username.trim().slice(0, 254) : "";
      const password = typeof record.password === "string" ? record.password : "";
      if (username && !password) throw new AppError(400, "SMTP_SECRET_REQUIRED", "SMTP 帳號已設定但缺少密碼。");
      if (password) {
        secretRef = `smtp-${crypto.randomUUID()}`;
        try {
          this.vault.put(secretRef, password);
        } catch (error) {
          if (error instanceof SecretVaultUnavailableError) {
            throw new AppError(409, "SECRET_VAULT_REQUIRED", error.message);
          }
          throw error;
        }
      }
      config = { host: host.toLowerCase(), port, secure: record.secure, username };
    }

    return publicConnector(this.store.createConnector({
      id: crypto.randomUUID(),
      name,
      connectorType: record.connectorType,
      senderEmail,
      senderName,
      config,
      secretRef,
      userId: user.id,
      occurredAt: new Date().toISOString(),
    }), true);
  }

  async verifyConnector(user: PublicUser, connectorId: string, input: unknown) {
    const record = recordFrom(input);
    const recipient = normalizedEmail(record.testRecipientEmail, "測試收件信箱");
    if (!this.getSettings().scope.testRecipientEmails.includes(recipient)) {
      throw new AppError(409, "TEST_MAILBOX_REQUIRED", "測試收件信箱不在 allowlist 內。");
    }
    try {
      const connector = this.store.getConnector(connectorId);
      await this.mail.verify(connector);
      await this.mail.send(connector, {
        to: { name: "Security Awareness Test", address: recipient },
        subject: "郵件連接器驗證（非演練）",
        html: "<p>這是本機社交工程演練平台的連接器驗證信，不包含追蹤元件。</p>",
        text: "這是本機社交工程演練平台的連接器驗證信，不包含追蹤元件。",
        attachments: [],
      });
      return publicConnector(this.store.markConnectorVerified(connectorId, user.id, new Date().toISOString()), true);
    } catch (error) {
      if (error instanceof CampaignNotFoundError) throw new AppError(404, "CONNECTOR_NOT_FOUND", error.message);
      throw error;
    }
  }

  listCampaigns() {
    return this.store.listCampaigns();
  }

  getCampaign(campaignId: string): CampaignDetail {
    try {
      return this.store.getCampaign(campaignId);
    } catch (error) {
      if (error instanceof CampaignNotFoundError) throw new AppError(404, "CAMPAIGN_NOT_FOUND", error.message);
      throw error;
    }
  }

  createCampaign(user: PublicUser, input: unknown): CampaignDetail {
    this.assertQuota("進行中活動數", this.store.activeCampaignCount(), 1, this.limits.maxActiveCampaigns);
    const record = recordFrom(input);
    const name = textField(record.name, "活動名稱", 2, 120);
    const templateId = textField(record.templateId, "範本", 1, 80);
    const recipientGroupId = textField(record.recipientGroupId, "收件群組", 1, 80);
    const connectorId = textField(record.connectorId, "郵件連接器", 1, 80);
    const sendWindowStart = textField(record.sendWindowStart ?? "08:00", "寄送時窗起點", 5, 5);
    const sendWindowEnd = textField(record.sendWindowEnd ?? "18:00", "寄送時窗終點", 5, 5);
    if (!TIME_PATTERN.test(sendWindowStart) || !TIME_PATTERN.test(sendWindowEnd)) {
      throw new AppError(400, "INVALID_SEND_WINDOW", "寄送時窗必須使用 HH:mm 格式。");
    }
    const throttlePerMinute = Number(record.throttlePerMinute ?? 30);
    if (!Number.isInteger(throttlePerMinute) || throttlePerMinute < 1 || throttlePerMinute > this.limits.maxThrottlePerMinute) {
      throw new AppError(
        400,
        "INVALID_THROTTLE",
        `每分鐘寄送量必須介於 1 到 ${this.limits.maxThrottlePerMinute}。`,
      );
    }
    if (typeof record.testOnly !== "boolean") {
      throw new AppError(400, "INVALID_TEST_MODE", "testOnly 必須是布林值。");
    }
    try {
      return this.store.createCampaign({
        id: crypto.randomUUID(),
        name,
        templateId,
        recipientGroupId,
        connectorId,
        sendWindowStart,
        sendWindowEnd,
        throttlePerMinute,
        baseUrl: validateBaseUrl(record.baseUrl, this.allowedTrackingOrigins),
        testOnly: record.testOnly,
        userId: user.id,
        occurredAt: new Date().toISOString(),
      });
    } catch (error) {
      this.rethrowCampaignError(error);
    }
  }

  submitReview(user: PublicUser, campaignId: string, input: unknown): CampaignDetail {
    const record = recordFrom(input);
    const comment = typeof record.comment === "string" ? record.comment.trim().slice(0, 1_000) : "";
    try {
      const campaign = this.getCampaign(campaignId);
      const recipients = this.store.recipientsForReview(
        campaignId,
        this.getSettings().scope.testRecipientEmails,
      );
      if (!recipients.length) {
        throw new AppError(409, "NO_REVIEW_TARGETS", "目前核准範圍內沒有可送審的收件人。");
      }
      this.assertQuota("單一活動收件人數", 0, recipients.length, this.limits.maxRecipientsPerCampaign);
      this.assertCampaignScope(campaign, recipients);
      return this.store.submitCampaignReview({
        id: crypto.randomUUID(),
        campaignId,
        userId: user.id,
        comment,
        approvalDigest: campaignApprovalDigest(campaign, recipients),
        recipients,
        occurredAt: new Date().toISOString(),
      });
    } catch (error) {
      this.rethrowCampaignError(error);
    }
  }

  decideReview(user: PublicUser, campaignId: string, reviewId: string, input: unknown): CampaignDetail {
    const record = recordFrom(input);
    if (record.decision !== "approved" && record.decision !== "rejected") {
      throw new AppError(400, "INVALID_DECISION", "審核決定必須是 approved 或 rejected。");
    }
    const comment = typeof record.comment === "string" ? record.comment.trim().slice(0, 1_000) : "";
    if (record.decision === "rejected" && !comment) {
      throw new AppError(400, "COMMENT_REQUIRED", "退回活動時必須填寫原因。");
    }
    try {
      return this.store.decideCampaignReview({
        campaignId,
        reviewId,
        reviewerId: user.id,
        decision: record.decision,
        comment,
        occurredAt: new Date().toISOString(),
      });
    } catch (error) {
      this.rethrowCampaignError(error);
    }
  }

  schedule(user: PublicUser, campaignId: string, input: unknown): CampaignDetail {
    const record = recordFrom(input);
    const scheduledAt = isoTimestamp(record.scheduledAt, "排程時間", true);
    const campaign = this.getCampaign(campaignId);
    const approved = this.store.approvedRecipients(campaignId);
    const recipients = approved.recipients;
    if (!recipients.length) {
      throw new AppError(409, "NO_APPROVED_TARGETS", "活動沒有核准的收件人快照。");
    }
    this.assertQuota("單一活動收件人數", 0, recipients.length, this.limits.maxRecipientsPerCampaign);
    this.assertCampaignScope(campaign, recipients);
    if (campaignApprovalDigest(campaign, recipients) !== approved.approvalDigest) {
      throw new AppError(409, "APPROVAL_DIGEST_MISMATCH", "活動核准內容不一致，請重新送審。");
    }
    const start = Date.parse(scheduledAt);
    const scheduledDate = new Date(start);
    const monthStart = new Date(Date.UTC(scheduledDate.getUTCFullYear(), scheduledDate.getUTCMonth(), 1)).toISOString();
    const monthEnd = new Date(Date.UTC(scheduledDate.getUTCFullYear(), scheduledDate.getUTCMonth() + 1, 1)).toISOString();
    this.assertQuota(
      "每月排程郵件數",
      this.store.committedDeliveryCountBetween(monthStart, monthEnd),
      recipients.length,
      this.limits.maxMonthlyMessages,
    );
    const observationDays = Math.min(this.getSettings().organization.retentionDays, 90);
    const expiresAt = new Date(start + observationDays * 86_400_000).toISOString();
    const targets = recipients.map((recipient, index) => {
      const token = crypto.randomBytes(32).toString("base64url");
      const minuteOffset = Math.floor(index / campaign.throttlePerMinute);
      return {
        id: crypto.randomUUID(),
        recipient,
        token,
        tokenHash: hashToken(token),
        nextAttemptAt: new Date(start + minuteOffset * 60_000).toISOString(),
        validFrom: scheduledAt,
        expiresAt,
      };
    });
    try {
      return this.store.scheduleCampaign({
        campaignId,
        scheduledAt,
        approvalDigest: approved.approvalDigest,
        targets,
        userId: user.id,
        occurredAt: new Date().toISOString(),
      });
    } catch (error) {
      this.rethrowCampaignError(error);
    }
  }

  operate(user: PublicUser, campaignId: string, operation: unknown): CampaignDetail {
    if (operation !== "pause" && operation !== "resume" && operation !== "cancel") {
      throw new AppError(400, "INVALID_OPERATION", "活動操作必須是 pause、resume 或 cancel。");
    }
    try {
      return this.store.setCampaignOperation({
        campaignId,
        operation,
        userId: user.id,
        occurredAt: new Date().toISOString(),
      });
    } catch (error) {
      this.rethrowCampaignError(error);
    }
  }

  addSuppression(user: PublicUser, input: unknown): void {
    const record = recordFrom(input);
    const email = normalizedEmail(record.email, "Email");
    const reason = textField(record.reason, "抑制原因", 2, 500);
    this.store.addSuppression({ email, reason, userId: user.id, occurredAt: new Date().toISOString() });
    this.store.suppressQueuedDeliveries(new Date().toISOString());
  }

  async processQueue(limit = 25): Promise<{ processed: number; sent: number; failed: number; stopped: boolean }> {
    if (this.processing) return { processed: 0, sent: 0, failed: 0, stopped: false };
    if (this.platformStore.getDeliveryControl().emergencyStop) {
      return { processed: 0, sent: 0, failed: 0, stopped: true };
    }
    this.processing = true;
    let sent = 0;
    let failed = 0;
    try {
      const now = new Date();
      this.store.recoverStaleSending(
        new Date(now.getTime() - 10 * 60_000).toISOString(),
        now.toISOString(),
      );
      this.store.expireQueuedDeliveries(now.toISOString());
      this.store.suppressQueuedDeliveries(now.toISOString());
      const deliveries = this.store.nextQueuedDeliveries(now.toISOString(), Math.max(1, Math.min(100, limit)));
      for (const delivery of deliveries) {
        if (this.platformStore.getDeliveryControl().emergencyStop) break;
        const campaign = this.store.getCampaign(delivery.campaignId);
        if (!withinSendWindow(new Date(), this.getSettings().organization.timezone, campaign.sendWindowStart, campaign.sendWindowEnd)) {
          continue;
        }
        const occurredAt = new Date().toISOString();
        try {
          this.assertCampaignScope(campaign, [{
            id: delivery.targetId,
            email: delivery.recipientEmail,
            displayName: delivery.recipientName,
            department: "",
            businessUnit: "",
          }]);
        } catch (error) {
          if (error instanceof AppError && error.statusCode === 409) {
            this.store.rejectDeliveryScope(delivery.deliveryId, occurredAt, error.message);
            failed += 1;
            continue;
          }
          throw error;
        }
        if (!this.store.markSending(delivery.deliveryId, occurredAt)) continue;
        try {
          const result = await this.mail.send(delivery.connector, this.mail.messageForDelivery(delivery));
          this.store.markSent(delivery.deliveryId, result.messageId, new Date().toISOString());
          sent += 1;
        } catch (error) {
          const details = error as { responseCode?: unknown; code?: unknown; message?: unknown };
          const responseCode = Number(details.responseCode ?? 0);
          const attempt = delivery.attemptCount + 1;
          const permanent = (responseCode >= 500 && responseCode < 600) || attempt >= 3;
          const delay = attempt === 1 ? 5 * 60_000 : 30 * 60_000;
          this.store.markDeliveryFailure({
            deliveryId: delivery.deliveryId,
            permanent,
            errorCode: String(details.code ?? (responseCode || "SEND_FAILED")),
            message: String(details.message ?? "郵件傳送失敗。"),
            nextAttemptAt: new Date(Date.now() + delay).toISOString(),
            occurredAt: new Date().toISOString(),
          });
          failed += 1;
        }
      }
      this.store.finishCompletedCampaigns(new Date().toISOString());
      return { processed: sent + failed, sent, failed, stopped: false };
    } finally {
      this.processing = false;
    }
  }

  recordTrackingEvent(input: {
    token: string;
    eventType: SimulationEventType;
    source: "tracking_endpoint" | "controlled_attachment";
    actorClass: "human_likely" | "automated_likely" | "unknown";
    confidence: "low" | "medium" | "high";
    fingerprintHash: string | null;
    attachmentId?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    try {
      return this.store.recordEventByToken({
        tokenHash: hashToken(input.token),
        eventType: input.eventType,
        source: input.source,
        actorClass: input.actorClass,
        confidence: input.confidence,
        fingerprintHash: input.fingerprintHash,
        attachmentId: input.attachmentId ?? null,
        metadata: input.metadata ?? {},
        occurredAt: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof CampaignNotFoundError) throw new AppError(404, "TRACKING_NOT_FOUND", error.message);
      throw error;
    }
  }

  controlledAttachment(token: string, attachmentId: string) {
    try {
      return this.store.getControlledAttachment(hashToken(token), attachmentId, new Date().toISOString());
    } catch (error) {
      if (error instanceof CampaignNotFoundError) throw new AppError(404, "ATTACHMENT_NOT_FOUND", error.message);
      throw error;
    }
  }

  importAuditEvents(user: PublicUser, campaignId: string, input: unknown) {
    const record = recordFrom(input);
    const sourceDigest = textField(record.sourceDigest, "來源檔案 SHA-256", 64, 64).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sourceDigest)) {
      throw new AppError(400, "INVALID_SOURCE_DIGEST", "來源檔案 SHA-256 格式不正確。");
    }
    const sourceReference = textField(record.sourceReference, "來源參照", 2, 300);
    if (!Array.isArray(record.events) || record.events.length > 10_000) {
      throw new AppError(400, "INVALID_EVENTS", "events 必須是最多 10,000 筆的陣列。");
    }
    const events = record.events.map((value, index) => {
      const item = recordFrom(value);
      const eventType = item.eventType;
      if (eventType !== "attachment_opened" && eventType !== "delivery_bounced") {
        throw new AppError(400, "INVALID_EVENT", `第 ${index + 1} 筆只支援 attachment_opened 或 delivery_bounced。`);
      }
      const occurredAt = isoTimestamp(item.occurredAt, "事件時間");
      const attachmentId = typeof item.attachmentId === "string" && item.attachmentId.trim()
        ? item.attachmentId.trim()
        : null;
      if (eventType === "attachment_opened" && !attachmentId) {
        throw new AppError(400, "ATTACHMENT_REQUIRED", `第 ${index + 1} 筆附件開啟事件必須綁定核准附件。`);
      }
      if (eventType === "delivery_bounced" && attachmentId) {
        throw new AppError(400, "ATTACHMENT_NOT_ALLOWED", `第 ${index + 1} 筆退信事件不可包含附件。`);
      }
      return {
        email: normalizedEmail(item.email, "Email"),
        eventType: eventType as "attachment_opened" | "delivery_bounced",
        attachmentId,
        occurredAt,
        sourceEventId: textField(item.sourceEventId, "來源事件 ID", 2, 160),
      };
    });
    try {
      return this.store.importAuditedEvents({
        campaignId,
        sourceDigest,
        sourceReference,
        events,
        userId: user.id,
        importedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.rethrowCampaignError(error);
    }
  }

  reportData(campaignId: string) {
    const campaign = this.getCampaign(campaignId);
    return { campaign, rows: this.store.reportRows(campaignId) };
  }

  private assertCampaignScope(campaign: CampaignDetail, recipients: CampaignRecipientSnapshot[]): void {
    if (!this.allowedTrackingOrigins.has(campaign.baseUrl)) {
      throw new AppError(409, "TRACKING_ORIGIN_REVOKED", "活動追蹤 Origin 已不在部署核准清單內。");
    }
    const settings = this.getSettings();
    const testRecipients = new Set(settings.scope.testRecipientEmails.map((email) => email.toLowerCase()));
    for (const recipient of recipients) {
      const email = recipient.email.toLowerCase();
      const domain = email.slice(email.lastIndexOf("@") + 1);
      if (!settings.scope.recipientDomains.includes(domain)) {
        throw new AppError(409, "RECIPIENT_SCOPE_REVOKED", `收件網域已不在核准範圍：${domain}`);
      }
      if (campaign.testOnly && !testRecipients.has(email)) {
        throw new AppError(409, "TEST_SCOPE_REVOKED", "測試活動包含已移出 allowlist 的信箱。");
      }
    }
    const connector = this.store.getConnector(campaign.connectorId);
    const senderDomain = connector.senderEmail.toLowerCase().slice(connector.senderEmail.lastIndexOf("@") + 1);
    if (connector.status !== "ready" || !settings.scope.senderDomains.includes(senderDomain)) {
      throw new AppError(409, "SENDER_SCOPE_REVOKED", "寄件連接器或寄件網域已不在核准範圍。");
    }
  }

  private rethrowCampaignError(error: unknown): never {
    if (error instanceof CampaignNotFoundError) throw new AppError(404, "CAMPAIGN_RESOURCE_NOT_FOUND", error.message);
    if (error instanceof CampaignConflictError) throw new AppError(409, "CAMPAIGN_CONFLICT", error.message);
    throw error;
  }

  private assertQuota(label: string, current: number, requested: number, maximum: number): void {
    try {
      assertQuotaAvailable(label, current, requested, maximum);
    } catch (error) {
      if (error instanceof SaaSQuotaExceededError) {
        throw new AppError(409, "TENANT_QUOTA_EXCEEDED", error.message);
      }
      throw error;
    }
  }
}
