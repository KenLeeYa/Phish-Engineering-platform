import type { DatabaseSync } from "node:sqlite";

export type ConnectorType = "pickup" | "smtp";
export type CampaignStatus =
  | "draft"
  | "pending_review"
  | "approved"
  | "scheduled"
  | "running"
  | "paused"
  | "completed"
  | "cancelled";
export type SimulationEventType =
  | "email_opened"
  | "link_clicked"
  | "attachment_opened"
  | "training_viewed"
  | "training_acknowledged"
  | "delivery_bounced";

export interface StoredConnector {
  id: string;
  name: string;
  connectorType: ConnectorType;
  senderEmail: string;
  senderName: string;
  config: Record<string, unknown>;
  secretRef: string | null;
  status: "draft" | "ready" | "disabled";
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignSummary {
  id: string;
  name: string;
  status: CampaignStatus;
  templateId: string;
  templateName: string;
  subject: string;
  recipientGroupId: string;
  recipientGroupName: string;
  connectorId: string;
  connectorName: string;
  scheduledAt: string | null;
  throttlePerMinute: number;
  testOnly: boolean;
  createdBy: string;
  approvedBy: string | null;
  targetCount: number;
  sentCount: number;
  failedCount: number;
  suppressedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignReviewSummary {
  id: string;
  requestedBy: string;
  reviewedBy: string | null;
  decision: "pending" | "approved" | "rejected";
  comment: string;
  requestedAt: string;
  reviewedAt: string | null;
  recipientCount: number;
  approvalDigest: string | null;
}

export interface CampaignRecipientSnapshot {
  id: string;
  email: string;
  displayName: string;
  department: string;
  businessUnit: string;
}

export interface CampaignDetail extends CampaignSummary {
  baseUrl: string;
  sendWindowStart: string;
  sendWindowEnd: string;
  reviews: CampaignReviewSummary[];
  metrics: CampaignMetrics;
}

export interface CampaignMetrics {
  targetCount: number;
  sentAcceptedCount: number;
  deliveredCount: null;
  uniqueOpened: number;
  uniqueClicked: number;
  uniqueAttachmentOpened: number;
  uniqueTrainingAcknowledged: number;
  automatedEventCount: number;
  humanEventCount: number;
  openRate: number | null;
  clickRate: number | null;
  attachmentOpenRate: number | null;
  acknowledgementRate: number | null;
}

export interface QueuedDelivery {
  deliveryId: string;
  targetId: string;
  campaignId: string;
  campaignName: string;
  trackingToken: string;
  baseUrl: string;
  recipientEmail: string;
  recipientName: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  connector: StoredConnector;
  attachments: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    content: Buffer;
  }>;
  attemptCount: number;
  testOnly: boolean;
}

export interface ReportEventRow {
  businessUnit: string;
  department: string;
  recipientName: string;
  email: string;
  subject: string;
  attachmentName: string;
  occurredAt: string;
  action: string;
  source: string;
  actorClass: string;
  confidence: string;
}

export class CampaignNotFoundError extends Error {}
export class CampaignConflictError extends Error {}

interface ConnectorRow {
  id: string;
  name: string;
  connector_type: ConnectorType;
  sender_email: string;
  sender_name: string;
  config_json: string;
  secret_ref: string | null;
  status: StoredConnector["status"];
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CampaignRow {
  id: string;
  name: string;
  status: CampaignStatus;
  template_id: string;
  template_name: string;
  subject: string;
  recipient_group_id: string;
  recipient_group_name: string;
  connector_id: string;
  connector_name: string;
  scheduled_at: string | null;
  throttle_per_minute: number;
  test_only: number;
  created_by: string;
  approved_by: string | null;
  target_count: number;
  sent_count: number;
  failed_count: number;
  suppressed_count: number;
  created_at: string;
  updated_at: string;
  base_url: string;
  send_window_start: string;
  send_window_end: string;
}

function mapConnector(row: ConnectorRow): StoredConnector {
  return {
    id: row.id,
    name: row.name,
    connectorType: row.connector_type,
    senderEmail: row.sender_email,
    senderName: row.sender_name,
    config: JSON.parse(row.config_json) as Record<string, unknown>,
    secretRef: row.secret_ref,
    status: row.status,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCampaign(row: CampaignRow): CampaignSummary {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    templateId: row.template_id,
    templateName: row.template_name,
    subject: row.subject,
    recipientGroupId: row.recipient_group_id,
    recipientGroupName: row.recipient_group_name,
    connectorId: row.connector_id,
    connectorName: row.connector_name,
    scheduledAt: row.scheduled_at,
    throttlePerMinute: Number(row.throttle_per_minute),
    testOnly: Boolean(row.test_only),
    createdBy: row.created_by,
    approvedBy: row.approved_by,
    targetCount: Number(row.target_count),
    sentCount: Number(row.sent_count),
    failedCount: Number(row.failed_count),
    suppressedCount: Number(row.suppressed_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class CampaignStore {
  constructor(private readonly database: DatabaseSync) {}

  private transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private audit(
    occurredAt: string,
    actorUserId: string | null,
    action: string,
    objectType: string,
    objectId: string | null,
    metadata: Record<string, unknown>,
  ): void {
    this.database
      .prepare(`
        INSERT INTO audit_log(
          occurred_at, actor_user_id, action, object_type, object_id, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(occurredAt, actorUserId, action, objectType, objectId, JSON.stringify(metadata));
  }

  listConnectors(): StoredConnector[] {
    const rows = this.database
      .prepare(`
        SELECT id, name, connector_type, sender_email, sender_name, config_json,
               secret_ref, status, verified_at, created_at, updated_at
        FROM mail_connectors ORDER BY updated_at DESC
      `)
      .all() as unknown as ConnectorRow[];
    return rows.map(mapConnector);
  }

  getConnector(connectorId: string): StoredConnector {
    const row = this.database
      .prepare(`
        SELECT id, name, connector_type, sender_email, sender_name, config_json,
               secret_ref, status, verified_at, created_at, updated_at
        FROM mail_connectors WHERE id = ?
      `)
      .get(connectorId) as ConnectorRow | undefined;
    if (!row) throw new CampaignNotFoundError("找不到指定郵件連接器。");
    return mapConnector(row);
  }

  createConnector(input: {
    id: string;
    name: string;
    connectorType: ConnectorType;
    senderEmail: string;
    senderName: string;
    config: Record<string, unknown>;
    secretRef: string | null;
    userId: string;
    occurredAt: string;
  }): StoredConnector {
    this.transaction(() => {
      this.database
        .prepare(`
          INSERT INTO mail_connectors(
            id, name, connector_type, sender_email, sender_name, config_json,
            secret_ref, status, verified_at, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', NULL, ?, ?, ?)
        `)
        .run(
          input.id,
          input.name,
          input.connectorType,
          input.senderEmail,
          input.senderName,
          JSON.stringify(input.config),
          input.secretRef,
          input.userId,
          input.occurredAt,
          input.occurredAt,
        );
      this.audit(input.occurredAt, input.userId, "connector.created", "mail_connector", input.id, {
        connectorType: input.connectorType,
        senderDomain: input.senderEmail.split("@")[1] ?? "",
        secretStored: Boolean(input.secretRef),
      });
    });
    return this.getConnector(input.id);
  }

  markConnectorVerified(connectorId: string, userId: string, occurredAt: string): StoredConnector {
    const result = this.database
      .prepare(`
        UPDATE mail_connectors
        SET status = 'ready', verified_at = ?, updated_at = ?
        WHERE id = ? AND status != 'disabled'
      `)
      .run(occurredAt, occurredAt, connectorId);
    if (!result.changes) throw new CampaignNotFoundError("找不到可驗證的郵件連接器。");
    this.audit(occurredAt, userId, "connector.verified", "mail_connector", connectorId, {});
    return this.getConnector(connectorId);
  }

  listCampaigns(): CampaignSummary[] {
    return (this.database.prepare(this.campaignSelectSql("ORDER BY c.updated_at DESC")).all() as unknown as CampaignRow[])
      .map(mapCampaign);
  }

  createCampaign(input: {
    id: string;
    name: string;
    templateId: string;
    recipientGroupId: string;
    connectorId: string;
    sendWindowStart: string;
    sendWindowEnd: string;
    throttlePerMinute: number;
    baseUrl: string;
    testOnly: boolean;
    userId: string;
    occurredAt: string;
  }): CampaignDetail {
    this.transaction(() => {
      const template = this.database
        .prepare(`
          SELECT t.status, v.id AS version_id
          FROM email_templates t
          JOIN email_template_versions v ON v.id = (
            SELECT latest.id FROM email_template_versions latest
            WHERE latest.template_id = t.id ORDER BY latest.version_number DESC LIMIT 1
          )
          WHERE t.id = ?
        `)
        .get(input.templateId) as { status: string; version_id: string } | undefined;
      if (!template) throw new CampaignNotFoundError("找不到指定郵件範本。");
      if (template.status !== "approved") throw new CampaignConflictError("活動只能使用已核准的範本。");
      const group = this.database
        .prepare(`
          SELECT COUNT(m.recipient_id) AS recipient_count
          FROM recipient_groups g
          LEFT JOIN recipient_group_members m ON m.group_id = g.id
          WHERE g.id = ? GROUP BY g.id
        `)
        .get(input.recipientGroupId) as { recipient_count: number } | undefined;
      if (!group) throw new CampaignNotFoundError("找不到指定收件群組。");
      if (Number(group.recipient_count) === 0) throw new CampaignConflictError("收件群組沒有成員。");
      const connector = this.getConnector(input.connectorId);
      if (connector.status !== "ready") throw new CampaignConflictError("郵件連接器尚未完成測試驗證。");
      this.database
        .prepare(`
          INSERT INTO campaigns(
            id, name, template_id, template_version_id, recipient_group_id,
            connector_id, status, scheduled_at, send_window_start, send_window_end,
            throttle_per_minute, base_url, test_only, created_by, approved_by,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'draft', NULL, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
        `)
        .run(
          input.id,
          input.name,
          input.templateId,
          template.version_id,
          input.recipientGroupId,
          input.connectorId,
          input.sendWindowStart,
          input.sendWindowEnd,
          input.throttlePerMinute,
          input.baseUrl,
          input.testOnly ? 1 : 0,
          input.userId,
          input.occurredAt,
          input.occurredAt,
        );
      this.audit(input.occurredAt, input.userId, "campaign.created", "campaign", input.id, {
        testOnly: input.testOnly,
      });
    });
    return this.getCampaign(input.id);
  }

  getCampaign(campaignId: string): CampaignDetail {
    const row = this.database
      .prepare(this.campaignSelectSql("HAVING c.id = ?"))
      .get(campaignId) as CampaignRow | undefined;
    if (!row) throw new CampaignNotFoundError("找不到指定演練活動。");
    const reviews = this.database
      .prepare(`
        SELECT r.id, r.requested_by, r.reviewed_by, r.decision, r.comment,
               r.requested_at, r.reviewed_at, r.approval_digest,
               COUNT(rr.recipient_id) AS recipient_count
        FROM campaign_reviews r
        LEFT JOIN campaign_review_recipients rr ON rr.review_id = r.id
        WHERE r.campaign_id = ?
        GROUP BY r.id
        ORDER BY r.requested_at DESC
      `)
      .all(campaignId) as unknown as Array<{
        id: string;
        requested_by: string;
        reviewed_by: string | null;
        decision: CampaignReviewSummary["decision"];
        comment: string;
        requested_at: string;
        reviewed_at: string | null;
        approval_digest: string | null;
        recipient_count: number;
      }>;
    return {
      ...mapCampaign(row),
      baseUrl: row.base_url,
      sendWindowStart: row.send_window_start,
      sendWindowEnd: row.send_window_end,
      reviews: reviews.map((review) => ({
        id: review.id,
        requestedBy: review.requested_by,
        reviewedBy: review.reviewed_by,
        decision: review.decision,
        comment: review.comment,
        requestedAt: review.requested_at,
        reviewedAt: review.reviewed_at,
        recipientCount: Number(review.recipient_count),
        approvalDigest: review.approval_digest,
      })),
      metrics: this.getCampaignMetrics(campaignId),
    };
  }

  recipientsForReview(campaignId: string, testOnlyEmails: string[]): CampaignRecipientSnapshot[] {
    const campaign = this.database
      .prepare("SELECT recipient_group_id, test_only FROM campaigns WHERE id = ?")
      .get(campaignId) as { recipient_group_id: string; test_only: number } | undefined;
    if (!campaign) throw new CampaignNotFoundError("找不到指定演練活動。");
    const rows = this.database.prepare(`
      SELECT r.id, r.email, r.email_normalized, r.display_name, r.department, r.business_unit
      FROM recipient_group_members m JOIN recipients r ON r.id = m.recipient_id
      WHERE m.group_id = ? ORDER BY r.email_normalized
    `).all(campaign.recipient_group_id) as unknown as Array<{
      id: string;
      email: string;
      email_normalized: string;
      display_name: string;
      department: string;
      business_unit: string;
    }>;
    const allow = new Set(testOnlyEmails.map((email) => email.toLowerCase()));
    return rows
      .filter((row) => !campaign.test_only || allow.has(row.email_normalized))
      .map((row) => ({
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        department: row.department,
        businessUnit: row.business_unit,
      }));
  }

  approvedRecipients(campaignId: string): {
    reviewId: string;
    approvalDigest: string;
    recipients: CampaignRecipientSnapshot[];
  } {
    const review = this.database.prepare(`
      SELECT id, approval_digest FROM campaign_reviews
      WHERE campaign_id = ? AND decision = 'approved'
      ORDER BY reviewed_at DESC LIMIT 1
    `).get(campaignId) as { id: string; approval_digest: string | null } | undefined;
    if (!review?.approval_digest) throw new CampaignConflictError("活動沒有可用的核准名單快照。");
    const recipients = this.database.prepare(`
      SELECT recipient_id, email, display_name, department, business_unit
      FROM campaign_review_recipients WHERE review_id = ? ORDER BY lower(email)
    `).all(review.id) as unknown as Array<{
      recipient_id: string;
      email: string;
      display_name: string;
      department: string;
      business_unit: string;
    }>;
    if (!recipients.length) throw new CampaignConflictError("核准名單快照沒有收件人。");
    return {
      reviewId: review.id,
      approvalDigest: review.approval_digest,
      recipients: recipients.map((row) => ({
        id: row.recipient_id,
        email: row.email,
        displayName: row.display_name,
        department: row.department,
        businessUnit: row.business_unit,
      })),
    };
  }

  submitCampaignReview(input: {
    id: string;
    campaignId: string;
    userId: string;
    comment: string;
    approvalDigest: string;
    recipients: CampaignRecipientSnapshot[];
    occurredAt: string;
  }): CampaignDetail {
    this.transaction(() => {
      const campaign = this.database
        .prepare("SELECT status FROM campaigns WHERE id = ?")
        .get(input.campaignId) as { status: CampaignStatus } | undefined;
      if (!campaign) throw new CampaignNotFoundError("找不到指定演練活動。");
      if (campaign.status !== "draft") throw new CampaignConflictError("只有 Draft 活動可送交審核。");
      this.database
        .prepare(`
          INSERT INTO campaign_reviews(
            id, campaign_id, requested_by, reviewed_by, decision,
            comment, requested_at, reviewed_at, approval_digest
          ) VALUES (?, ?, ?, NULL, 'pending', ?, ?, NULL, ?)
        `)
        .run(input.id, input.campaignId, input.userId, input.comment, input.occurredAt, input.approvalDigest);
      const addRecipient = this.database.prepare(`
        INSERT INTO campaign_review_recipients(
          review_id, recipient_id, email, display_name, department, business_unit
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const recipient of input.recipients) {
        addRecipient.run(
          input.id,
          recipient.id,
          recipient.email,
          recipient.displayName,
          recipient.department,
          recipient.businessUnit,
        );
      }
      this.database
        .prepare("UPDATE campaigns SET status = 'pending_review', updated_at = ? WHERE id = ?")
        .run(input.occurredAt, input.campaignId);
      this.audit(input.occurredAt, input.userId, "campaign.review_requested", "campaign", input.campaignId, {
        reviewId: input.id,
        recipientCount: input.recipients.length,
        approvalDigest: input.approvalDigest,
      });
    });
    return this.getCampaign(input.campaignId);
  }

  decideCampaignReview(input: {
    campaignId: string;
    reviewId: string;
    reviewerId: string;
    decision: "approved" | "rejected";
    comment: string;
    occurredAt: string;
  }): CampaignDetail {
    this.transaction(() => {
      const review = this.database
        .prepare(`
          SELECT r.requested_by, r.decision, r.approval_digest, c.created_by, c.status,
                 (SELECT COUNT(*) FROM campaign_review_recipients rr WHERE rr.review_id = r.id) AS recipient_count
          FROM campaign_reviews r JOIN campaigns c ON c.id = r.campaign_id
          WHERE r.id = ? AND r.campaign_id = ?
        `)
        .get(input.reviewId, input.campaignId) as
        | {
            requested_by: string;
            decision: string;
            approval_digest: string | null;
            created_by: string;
            status: CampaignStatus;
            recipient_count: number;
          }
        | undefined;
      if (!review) throw new CampaignNotFoundError("找不到指定活動審核申請。");
      if (review.decision !== "pending" || review.status !== "pending_review") {
        throw new CampaignConflictError("此活動審核申請已完成或狀態已變更。");
      }
      if (review.requested_by === input.reviewerId || review.created_by === input.reviewerId) {
        throw new CampaignConflictError("活動建立者或送審者不可審核自己的活動。");
      }
      if (input.decision === "approved" && (!review.approval_digest || Number(review.recipient_count) === 0)) {
        throw new CampaignConflictError("活動缺少不可變核准名單，不能核准。");
      }
      this.database
        .prepare(`
          UPDATE campaign_reviews SET reviewed_by = ?, decision = ?, comment = ?, reviewed_at = ?
          WHERE id = ?
        `)
        .run(input.reviewerId, input.decision, input.comment, input.occurredAt, input.reviewId);
      this.database
        .prepare(`
          UPDATE campaigns SET status = ?, approved_by = ?, updated_at = ? WHERE id = ?
        `)
        .run(
          input.decision === "approved" ? "approved" : "draft",
          input.decision === "approved" ? input.reviewerId : null,
          input.occurredAt,
          input.campaignId,
        );
      this.audit(input.occurredAt, input.reviewerId, `campaign.${input.decision}`, "campaign", input.campaignId, {
        reviewId: input.reviewId,
      });
    });
    return this.getCampaign(input.campaignId);
  }

  scheduleCampaign(input: {
    campaignId: string;
    scheduledAt: string;
    approvalDigest: string;
    targets: Array<{
      id: string;
      recipient: CampaignRecipientSnapshot;
      token: string;
      tokenHash: string;
      nextAttemptAt: string;
      validFrom: string;
      expiresAt: string;
    }>;
    userId: string;
    occurredAt: string;
  }): CampaignDetail {
    this.transaction(() => {
      const campaign = this.database.prepare(`
        SELECT c.status, r.approval_digest
        FROM campaigns c
        JOIN campaign_reviews r ON r.campaign_id = c.id AND r.decision = 'approved'
        WHERE c.id = ? ORDER BY r.reviewed_at DESC LIMIT 1
      `).get(input.campaignId) as
        | { status: CampaignStatus; approval_digest: string | null }
        | undefined;
      if (!campaign) throw new CampaignNotFoundError("找不到指定演練活動。");
      if (campaign.status !== "approved") throw new CampaignConflictError("只有已核准活動可排程。");
      if (campaign.approval_digest !== input.approvalDigest) {
        throw new CampaignConflictError("活動核准內容已變更，請重新送審。");
      }
      const addTarget = this.database.prepare(`
        INSERT INTO campaign_targets(
          id, campaign_id, recipient_id, tracking_token_hash, tracking_token, created_at,
          email_snapshot, display_name_snapshot, department_snapshot, business_unit_snapshot,
          valid_from, expires_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `);
      const addDelivery = this.database.prepare(`
        INSERT INTO deliveries(
          id, campaign_target_id, status, attempt_count, next_attempt_at,
          sent_at, last_error_code, last_error_message, message_id, updated_at
        ) VALUES (?, ?, 'queued', 0, ?, NULL, NULL, NULL, NULL, ?)
      `);
      for (const target of input.targets) {
        addTarget.run(
          target.id,
          input.campaignId,
          target.recipient.id,
          target.tokenHash,
          target.token,
          input.occurredAt,
          target.recipient.email,
          target.recipient.displayName,
          target.recipient.department,
          target.recipient.businessUnit,
          target.validFrom,
          target.expiresAt,
        );
        addDelivery.run(target.id, target.id, target.nextAttemptAt, input.occurredAt);
      }
      this.database
        .prepare("UPDATE campaigns SET status = 'scheduled', scheduled_at = ?, updated_at = ? WHERE id = ?")
        .run(input.scheduledAt, input.occurredAt, input.campaignId);
      this.audit(input.occurredAt, input.userId, "campaign.scheduled", "campaign", input.campaignId, {
        scheduledAt: input.scheduledAt,
        targetCount: input.targets.length,
        approvalDigest: input.approvalDigest,
      });
    });
    return this.getCampaign(input.campaignId);
  }

  nextQueuedDeliveries(now: string, limit: number): QueuedDelivery[] {
    const rows = this.database
      .prepare(`
        SELECT d.id AS delivery_id, d.attempt_count, ct.id AS target_id,
               ct.campaign_id, ct.tracking_token, c.name AS campaign_name, c.base_url,
               ct.email_snapshot AS email, ct.display_name_snapshot AS display_name,
               c.test_only, v.subject, v.html_body, v.text_body,
               mc.id, mc.name, mc.connector_type, mc.sender_email, mc.sender_name,
               mc.config_json, mc.secret_ref, mc.status, mc.verified_at,
               mc.created_at, mc.updated_at
        FROM deliveries d
        JOIN campaign_targets ct ON ct.id = d.campaign_target_id
        JOIN campaigns c ON c.id = ct.campaign_id
        JOIN email_template_versions v ON v.id = c.template_version_id
        JOIN mail_connectors mc ON mc.id = c.connector_id
        WHERE d.status = 'queued' AND d.next_attempt_at <= ?
          AND ct.revoked_at IS NULL AND ct.tracking_token <> ''
          AND ct.valid_from IS NOT NULL AND ct.valid_from <= ?
          AND ct.expires_at IS NOT NULL AND ct.expires_at > ?
          AND c.status IN ('scheduled', 'running')
        ORDER BY d.next_attempt_at, d.id
        LIMIT ?
      `)
      .all(now, now, now, limit) as unknown as Array<ConnectorRow & {
        delivery_id: string;
        attempt_count: number;
        target_id: string;
        campaign_id: string;
        campaign_name: string;
        tracking_token: string;
        base_url: string;
        email: string;
        display_name: string;
        subject: string;
        html_body: string;
        text_body: string;
        test_only: number;
      }>;
    return rows.map((row) => {
      const attachmentRows = this.database
        .prepare(`
          SELECT a.id, a.file_name, a.mime_type, a.content_blob
          FROM campaigns c
          JOIN template_attachments a ON a.version_id = c.template_version_id
          WHERE c.id = ? AND a.storage_status = 'approved' AND a.content_blob IS NOT NULL
          ORDER BY a.file_name
        `)
        .all(row.campaign_id) as unknown as Array<{
          id: string;
          file_name: string;
          mime_type: string;
          content_blob: Uint8Array;
        }>;
      return {
        deliveryId: row.delivery_id,
        targetId: row.target_id,
        campaignId: row.campaign_id,
        campaignName: row.campaign_name,
        trackingToken: row.tracking_token,
        baseUrl: row.base_url,
        recipientEmail: row.email,
        recipientName: row.display_name,
        subject: row.subject,
        htmlBody: row.html_body,
        textBody: row.text_body,
        connector: mapConnector(row),
        attachments: attachmentRows.map((attachment) => ({
          id: attachment.id,
          fileName: attachment.file_name,
          mimeType: attachment.mime_type,
          content: Buffer.from(attachment.content_blob),
        })),
        attemptCount: Number(row.attempt_count),
        testOnly: Boolean(row.test_only),
      };
    });
  }

  expireQueuedDeliveries(occurredAt: string): number {
    return this.transaction(() => {
      const result = this.database.prepare(`
        UPDATE deliveries
        SET status = 'cancelled', last_error_code = 'TOKEN_EXPIRED',
            last_error_message = '追蹤有效期已結束，未寄送目標已取消。', updated_at = ?
        WHERE status = 'queued' AND campaign_target_id IN (
          SELECT id FROM campaign_targets
          WHERE revoked_at IS NOT NULL OR expires_at IS NULL OR expires_at <= ?
        )
      `).run(occurredAt, occurredAt);
      if (result.changes) {
        this.database.prepare(`
          UPDATE campaign_targets
          SET tracking_token = '', revoked_at = COALESCE(revoked_at, ?)
          WHERE id IN (
            SELECT campaign_target_id FROM deliveries
            WHERE status = 'cancelled' AND last_error_code = 'TOKEN_EXPIRED'
          )
        `).run(occurredAt);
        this.audit(occurredAt, null, "delivery.expired_targets_cancelled", "platform", "local", {
          count: Number(result.changes),
        });
      }
      return Number(result.changes);
    });
  }

  rejectDeliveryScope(deliveryId: string, occurredAt: string, reason: string): void {
    this.transaction(() => {
      this.database.prepare(`
        UPDATE deliveries SET status = 'failed', attempt_count = attempt_count + 1,
          last_error_code = 'SCOPE_REVOKED', last_error_message = ?, updated_at = ?
        WHERE id = ? AND status = 'queued'
      `).run(reason.slice(0, 500), occurredAt, deliveryId);
      this.database.prepare(`
        UPDATE campaign_targets SET tracking_token = '', revoked_at = ?
        WHERE id = (SELECT campaign_target_id FROM deliveries WHERE id = ?)
      `).run(occurredAt, deliveryId);
      this.audit(occurredAt, null, "delivery.scope_rejected", "delivery", deliveryId, {
        reason: reason.slice(0, 200),
      });
    });
  }

  markSending(deliveryId: string, occurredAt: string): boolean {
    return Boolean(
      this.database
        .prepare(`
          UPDATE deliveries SET status = 'sending', updated_at = ?
          WHERE id = ? AND status = 'queued' AND EXISTS (
            SELECT 1 FROM campaign_targets ct JOIN campaigns c ON c.id = ct.campaign_id
            WHERE ct.id = deliveries.campaign_target_id
              AND ct.revoked_at IS NULL AND ct.tracking_token <> ''
              AND ct.valid_from IS NOT NULL AND ct.valid_from <= ?
              AND ct.expires_at IS NOT NULL AND ct.expires_at > ?
              AND c.status IN ('scheduled', 'running')
          )
        `)
        .run(occurredAt, deliveryId, occurredAt, occurredAt).changes,
    );
  }

  markSent(deliveryId: string, messageId: string, occurredAt: string): void {
    this.transaction(() => {
      const row = this.database
        .prepare(`
          UPDATE deliveries SET status = 'sent', attempt_count = attempt_count + 1,
            sent_at = ?, message_id = ?, last_error_code = NULL,
            last_error_message = NULL, updated_at = ? WHERE id = ?
          RETURNING campaign_target_id
        `)
        .get(occurredAt, messageId, occurredAt, deliveryId) as { campaign_target_id: string } | undefined;
      if (!row) return;
      this.database
        .prepare("UPDATE campaign_targets SET tracking_token = '' WHERE id = ?")
        .run(row.campaign_target_id);
      const campaign = this.database
        .prepare("SELECT campaign_id FROM campaign_targets WHERE id = ?")
        .get(row.campaign_target_id) as { campaign_id: string };
      this.database
        .prepare("UPDATE campaigns SET status = 'running', updated_at = ? WHERE id = ? AND status = 'scheduled'")
        .run(occurredAt, campaign.campaign_id);
      this.audit(occurredAt, null, "delivery.sent", "delivery", deliveryId, { messageId });
    });
  }

  markDeliveryFailure(input: {
    deliveryId: string;
    permanent: boolean;
    errorCode: string;
    message: string;
    nextAttemptAt: string;
    occurredAt: string;
  }): void {
    this.transaction(() => {
      this.database
        .prepare(`
          UPDATE deliveries SET status = ?, attempt_count = attempt_count + 1,
            next_attempt_at = ?, last_error_code = ?, last_error_message = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(
          input.permanent ? "failed" : "queued",
          input.nextAttemptAt,
          input.errorCode.slice(0, 80),
          input.message.slice(0, 500),
          input.occurredAt,
          input.deliveryId,
        );
      if (input.permanent) {
        this.database.prepare(`
          UPDATE campaign_targets SET tracking_token = ''
          WHERE id = (SELECT campaign_target_id FROM deliveries WHERE id = ?)
        `).run(input.deliveryId);
      }
      this.audit(input.occurredAt, null, "delivery.failed", "delivery", input.deliveryId, {
        permanent: input.permanent,
        errorCode: input.errorCode.slice(0, 80),
      });
    });
  }

  suppressQueuedDeliveries(occurredAt: string): number {
    return this.transaction(() => {
      const result = this.database.prepare(`
        UPDATE deliveries SET status = 'suppressed', updated_at = ?
        WHERE status = 'queued' AND campaign_target_id IN (
          SELECT ct.id FROM campaign_targets ct
          JOIN suppression_list s ON s.email_normalized = lower(ct.email_snapshot)
        )
      `).run(occurredAt);
      this.database.prepare(`
        UPDATE campaign_targets SET tracking_token = ''
        WHERE id IN (SELECT campaign_target_id FROM deliveries WHERE status = 'suppressed')
      `).run();
      return Number(result.changes);
    });
  }

  addSuppression(input: {
    email: string;
    reason: string;
    userId: string;
    occurredAt: string;
  }): void {
    this.database
      .prepare(`
        INSERT INTO suppression_list(email_normalized, reason, created_by, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(email_normalized) DO UPDATE SET reason = excluded.reason,
          created_by = excluded.created_by, created_at = excluded.created_at
      `)
      .run(input.email, input.reason, input.userId, input.occurredAt);
    this.audit(input.occurredAt, input.userId, "suppression.upserted", "recipient", null, {
      emailDomain: input.email.split("@")[1] ?? "",
      reason: input.reason,
    });
  }

  setCampaignOperation(input: {
    campaignId: string;
    operation: "pause" | "resume" | "cancel";
    userId: string;
    occurredAt: string;
  }): CampaignDetail {
    this.transaction(() => {
      const row = this.database
        .prepare("SELECT status FROM campaigns WHERE id = ?")
        .get(input.campaignId) as { status: CampaignStatus } | undefined;
      if (!row) throw new CampaignNotFoundError("找不到指定演練活動。");
      const transitions: Record<typeof input.operation, { from: CampaignStatus[]; to: CampaignStatus }> = {
        pause: { from: ["scheduled", "running"], to: "paused" },
        resume: { from: ["paused"], to: "running" },
        cancel: { from: ["draft", "pending_review", "approved", "scheduled", "running", "paused"], to: "cancelled" },
      };
      const transition = transitions[input.operation];
      if (!transition.from.includes(row.status)) {
        throw new CampaignConflictError("活動目前狀態不能執行此操作。");
      }
      this.database
        .prepare("UPDATE campaigns SET status = ?, updated_at = ? WHERE id = ?")
        .run(transition.to, input.occurredAt, input.campaignId);
      if (input.operation === "cancel") {
        this.database.prepare(`
          UPDATE deliveries SET status = 'cancelled', updated_at = ?
          WHERE status = 'queued' AND campaign_target_id IN (
            SELECT id FROM campaign_targets WHERE campaign_id = ?
          )
        `).run(input.occurredAt, input.campaignId);
        this.database.prepare(`
          UPDATE campaign_targets
          SET tracking_token = '', revoked_at = ?
          WHERE campaign_id = ?
        `).run(input.occurredAt, input.campaignId);
      }
      this.audit(input.occurredAt, input.userId, `campaign.${input.operation}`, "campaign", input.campaignId, {});
    });
    return this.getCampaign(input.campaignId);
  }

  finishCompletedCampaigns(occurredAt: string): number {
    const result = this.database.prepare(`
      UPDATE campaigns SET status = 'completed', updated_at = ?
      WHERE status IN ('scheduled', 'running')
        AND NOT EXISTS (
          SELECT 1 FROM campaign_targets ct JOIN deliveries d ON d.campaign_target_id = ct.id
          WHERE ct.campaign_id = campaigns.id AND d.status IN ('queued', 'sending')
        )
    `).run(occurredAt);
    return Number(result.changes);
  }

  recoverStaleSending(cutoff: string, occurredAt: string): number {
    const result = this.database.prepare(`
      UPDATE deliveries
      SET status = 'queued', next_attempt_at = ?, last_error_code = 'WORKER_RECOVERY',
          last_error_message = '上一個 worker 未完成寄送狀態，已安全放回佇列。', updated_at = ?
      WHERE status = 'sending' AND updated_at < ?
    `).run(occurredAt, occurredAt, cutoff);
    return Number(result.changes);
  }

  recordEventByToken(input: {
    tokenHash: string;
    eventType: SimulationEventType;
    source: "tracking_endpoint" | "controlled_attachment";
    actorClass: "human_likely" | "automated_likely" | "unknown";
    confidence: "low" | "medium" | "high";
    fingerprintHash: string | null;
    attachmentId: string | null;
    metadata: Record<string, unknown>;
    occurredAt: string;
  }): { targetId: string; campaignId: string; recipientName: string } {
    const target = this.database
      .prepare(`
        SELECT ct.id, ct.campaign_id, ct.display_name_snapshot
        FROM campaign_targets ct
        JOIN deliveries d ON d.campaign_target_id = ct.id
        JOIN campaigns c ON c.id = ct.campaign_id
        WHERE ct.tracking_token_hash = ?
          AND d.status = 'sent'
          AND ct.revoked_at IS NULL
          AND ct.valid_from IS NOT NULL AND ct.valid_from <= ?
          AND ct.expires_at IS NOT NULL AND ct.expires_at > ?
          AND c.status IN ('running', 'paused', 'completed')
      `)
      .get(input.tokenHash, input.occurredAt, input.occurredAt) as
      | { id: string; campaign_id: string; display_name_snapshot: string }
      | undefined;
    if (!target) throw new CampaignNotFoundError("追蹤識別碼不存在或已失效。");
    if (input.attachmentId) {
      const attachment = this.database
        .prepare(`
          SELECT a.id FROM campaigns c JOIN template_attachments a ON a.version_id = c.template_version_id
          WHERE c.id = ? AND a.id = ? AND a.storage_status = 'approved'
        `)
        .get(target.campaign_id, input.attachmentId);
      if (!attachment) throw new CampaignNotFoundError("找不到核准的受控附件。");
    }
    const dedupeKey = [
      "tracking",
      input.eventType,
      input.source,
      input.actorClass,
      input.attachmentId ?? "-",
    ].join(":");
    this.database
      .prepare(`
        INSERT OR IGNORE INTO simulation_events(
          campaign_target_id, event_type, attachment_id, source, actor_class,
          confidence, client_fingerprint_hash, metadata_json, occurred_at, dedupe_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        target.id,
        input.eventType,
        input.attachmentId,
        input.source,
        input.actorClass,
        input.confidence,
        input.fingerprintHash,
        JSON.stringify(input.metadata),
        input.occurredAt,
        dedupeKey,
      );
    return {
      targetId: target.id,
      campaignId: target.campaign_id,
      recipientName: target.display_name_snapshot,
    };
  }

  getControlledAttachment(tokenHash: string, attachmentId: string, occurredAt: string): {
    fileName: string;
    mimeType: string;
    content: Buffer;
  } {
    const row = this.database
      .prepare(`
        SELECT a.file_name, a.mime_type, a.content_blob
        FROM campaign_targets ct
        JOIN deliveries d ON d.campaign_target_id = ct.id
        JOIN campaigns c ON c.id = ct.campaign_id
        JOIN template_attachments a ON a.version_id = c.template_version_id
        WHERE ct.tracking_token_hash = ? AND a.id = ?
          AND a.storage_status = 'approved' AND a.content_blob IS NOT NULL
          AND d.status = 'sent' AND ct.revoked_at IS NULL
          AND ct.valid_from IS NOT NULL AND ct.valid_from <= ?
          AND ct.expires_at IS NOT NULL AND ct.expires_at > ?
          AND c.status IN ('running', 'paused', 'completed')
      `)
      .get(tokenHash, attachmentId, occurredAt, occurredAt) as
      | { file_name: string; mime_type: string; content_blob: Uint8Array }
      | undefined;
    if (!row) throw new CampaignNotFoundError("找不到核准的受控附件。");
    return { fileName: row.file_name, mimeType: row.mime_type, content: Buffer.from(row.content_blob) };
  }

  importAuditedEvents(input: {
    campaignId: string;
    sourceDigest: string;
    sourceReference: string;
    events: Array<{
      email: string;
      eventType: "attachment_opened" | "delivery_bounced";
      attachmentId: string | null;
      occurredAt: string;
      sourceEventId: string;
    }>;
    userId: string;
    importedAt: string;
  }): { imported: number; skipped: number } {
    let imported = 0;
    let skipped = 0;
    this.transaction(() => {
      const campaign = this.database.prepare(`
        SELECT c.created_by,
               (SELECT requested_by FROM campaign_reviews r
                WHERE r.campaign_id = c.id AND r.decision = 'approved'
                ORDER BY r.reviewed_at DESC LIMIT 1) AS requested_by
        FROM campaigns c WHERE c.id = ?
      `).get(input.campaignId) as
        | { created_by: string; requested_by: string | null }
        | undefined;
      if (!campaign) throw new CampaignNotFoundError("找不到指定演練活動。");
      if (campaign.created_by === input.userId || campaign.requested_by === input.userId) {
        throw new CampaignConflictError("活動建立者或送審者不可匯入自己的正式稽核證據。");
      }
      const findTarget = this.database.prepare(`
        SELECT ct.id, ct.valid_from, ct.expires_at
        FROM campaign_targets ct
        WHERE ct.campaign_id = ? AND lower(ct.email_snapshot) = ?
      `);
      const insert = this.database.prepare(`
        INSERT OR IGNORE INTO simulation_events(
          campaign_target_id, event_type, attachment_id, source, actor_class,
          confidence, client_fingerprint_hash, metadata_json, occurred_at, dedupe_key
        ) VALUES (?, ?, ?, 'audit_import', 'human_likely', 'high', NULL, ?, ?, ?)
      `);
      for (const event of input.events) {
        const target = findTarget.get(input.campaignId, event.email) as
          | { id: string; valid_from: string | null; expires_at: string | null }
          | undefined;
        if (!target) {
          skipped += 1;
          continue;
        }
        if (
          !target.valid_from ||
          !target.expires_at ||
          event.occurredAt < target.valid_from ||
          event.occurredAt >= target.expires_at
        ) {
          skipped += 1;
          continue;
        }
        if (event.eventType === "attachment_opened") {
          if (!event.attachmentId) {
            skipped += 1;
            continue;
          }
          const attachment = this.database.prepare(`
            SELECT a.id FROM campaigns c
            JOIN template_attachments a ON a.version_id = c.template_version_id
            WHERE c.id = ? AND a.id = ? AND a.storage_status = 'approved'
          `).get(input.campaignId, event.attachmentId);
          if (!attachment) {
            skipped += 1;
            continue;
          }
        } else if (event.attachmentId) {
          skipped += 1;
          continue;
        }
        const result = insert.run(
          target.id,
          event.eventType,
          event.attachmentId,
          JSON.stringify({
            sourceReference: input.sourceReference,
            sourceDigest: input.sourceDigest,
            sourceEventId: event.sourceEventId,
          }),
          event.occurredAt,
          `audit:${input.sourceDigest}:${event.sourceEventId}`,
        );
        if (result.changes) imported += 1;
        else skipped += 1;
      }
      this.audit(input.importedAt, input.userId, "campaign.audit_events_imported", "campaign", input.campaignId, {
        imported,
        skipped,
        sourceDigest: input.sourceDigest,
        sourceReference: input.sourceReference,
      });
    });
    return { imported, skipped };
  }

  getCampaignMetrics(campaignId: string): CampaignMetrics {
    const row = this.database
      .prepare(`
        SELECT
          COUNT(DISTINCT ct.id) AS target_count,
          COUNT(DISTINCT CASE WHEN d.status = 'sent' THEN ct.id END) AS sent_accepted_count,
          COUNT(DISTINCT CASE WHEN e.event_type = 'email_opened' AND e.actor_class != 'automated_likely' THEN ct.id END) AS unique_opened,
          COUNT(DISTINCT CASE WHEN e.event_type = 'link_clicked' AND e.actor_class != 'automated_likely' THEN ct.id END) AS unique_clicked,
          COUNT(DISTINCT CASE WHEN e.event_type = 'attachment_opened' AND e.actor_class != 'automated_likely' THEN ct.id END) AS unique_attachment_opened,
          COUNT(DISTINCT CASE WHEN e.event_type = 'training_acknowledged' AND e.actor_class != 'automated_likely' THEN ct.id END) AS unique_training_acknowledged,
          COUNT(CASE WHEN e.actor_class = 'automated_likely' THEN 1 END) AS automated_event_count,
          COUNT(CASE WHEN e.actor_class = 'human_likely' THEN 1 END) AS human_event_count
        FROM campaign_targets ct
        LEFT JOIN deliveries d ON d.campaign_target_id = ct.id
        LEFT JOIN simulation_events e ON e.campaign_target_id = ct.id
        WHERE ct.campaign_id = ?
      `)
      .get(campaignId) as {
        target_count: number;
        sent_accepted_count: number;
        unique_opened: number;
        unique_clicked: number;
        unique_attachment_opened: number;
        unique_training_acknowledged: number;
        automated_event_count: number;
        human_event_count: number;
      };
    const targetCount = Number(row.target_count);
    const rate = (value: number): number | null => targetCount ? value / targetCount : null;
    return {
      targetCount,
      sentAcceptedCount: Number(row.sent_accepted_count),
      deliveredCount: null,
      uniqueOpened: Number(row.unique_opened),
      uniqueClicked: Number(row.unique_clicked),
      uniqueAttachmentOpened: Number(row.unique_attachment_opened),
      uniqueTrainingAcknowledged: Number(row.unique_training_acknowledged),
      automatedEventCount: Number(row.automated_event_count),
      humanEventCount: Number(row.human_event_count),
      openRate: rate(Number(row.unique_opened)),
      clickRate: rate(Number(row.unique_clicked)),
      attachmentOpenRate: rate(Number(row.unique_attachment_opened)),
      acknowledgementRate: rate(Number(row.unique_training_acknowledged)),
    };
  }

  reportRows(campaignId: string): ReportEventRow[] {
    return this.database
      .prepare(`
        SELECT ct.business_unit_snapshot AS business_unit,
               ct.department_snapshot AS department,
               ct.display_name_snapshot AS display_name,
               ct.email_snapshot AS email,
               v.subject, COALESCE(a.file_name, '') AS attachment_name,
               e.occurred_at, e.event_type, e.source, e.actor_class, e.confidence
        FROM simulation_events e
        JOIN campaign_targets ct ON ct.id = e.campaign_target_id
        JOIN campaigns c ON c.id = ct.campaign_id
        JOIN email_template_versions v ON v.id = c.template_version_id
        LEFT JOIN template_attachments a ON a.id = e.attachment_id
        WHERE c.id = ? ORDER BY e.occurred_at, e.id
      `)
      .all(campaignId)
      .map((value) => {
        const row = value as Record<string, unknown>;
        return {
          businessUnit: String(row.business_unit ?? ""),
          department: String(row.department ?? ""),
          recipientName: String(row.display_name ?? ""),
          email: String(row.email ?? ""),
          subject: String(row.subject ?? ""),
          attachmentName: String(row.attachment_name ?? ""),
          occurredAt: String(row.occurred_at ?? ""),
          action: String(row.event_type ?? ""),
          source: String(row.source ?? ""),
          actorClass: String(row.actor_class ?? ""),
          confidence: String(row.confidence ?? ""),
        };
      });
  }

  private campaignSelectSql(suffix: string): string {
    return `
      SELECT c.id, c.name, c.status, c.template_id, t.name AS template_name,
             v.subject, c.recipient_group_id, g.name AS recipient_group_name,
             c.connector_id, mc.name AS connector_name, c.scheduled_at,
             c.throttle_per_minute, c.test_only, c.created_by, c.approved_by,
             c.created_at, c.updated_at, c.base_url, c.send_window_start, c.send_window_end,
             COUNT(DISTINCT ct.id) AS target_count,
             COUNT(DISTINCT CASE WHEN d.status = 'sent' THEN d.id END) AS sent_count,
             COUNT(DISTINCT CASE WHEN d.status = 'failed' THEN d.id END) AS failed_count,
             COUNT(DISTINCT CASE WHEN d.status = 'suppressed' THEN d.id END) AS suppressed_count
      FROM campaigns c
      JOIN email_templates t ON t.id = c.template_id
      JOIN email_template_versions v ON v.id = c.template_version_id
      JOIN recipient_groups g ON g.id = c.recipient_group_id
      JOIN mail_connectors mc ON mc.id = c.connector_id
      LEFT JOIN campaign_targets ct ON ct.campaign_id = c.id
      LEFT JOIN deliveries d ON d.campaign_target_id = ct.id
      GROUP BY c.id
      ${suffix}
    `;
  }
}
