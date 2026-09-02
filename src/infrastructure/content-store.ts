import type { DatabaseSync } from "node:sqlite";

export interface RecipientRecordInput {
  id: string;
  email: string;
  emailNormalized: string;
  displayName: string;
  department: string;
  businessUnit: string;
}

export interface RecipientGroupSummary {
  id: string;
  name: string;
  description: string;
  recipientCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RecipientSummary {
  id: string;
  email: string;
  displayName: string;
  department: string;
  businessUnit: string;
}

export interface RecipientGroupDetail extends RecipientGroupSummary {
  recipients: RecipientSummary[];
  recipientsTruncated: boolean;
}

export interface StoredRecipientImportResult {
  insertedRecipients: number;
  updatedRecipients: number;
  addedMemberships: number;
}

export interface TemplateAttachmentInput {
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

export interface TemplateVersionInput {
  id: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  sourceType: "manual" | "eml_import";
  sourceFileName: string | null;
  sanitization: Record<string, unknown>;
  attachments: TemplateAttachmentInput[];
}

export interface TemplateSummary {
  id: string;
  name: string;
  status: "draft" | "pending_review" | "approved" | "archived";
  latestVersion: number;
  subject: string;
  sourceType: "manual" | "eml_import";
  approvedAttachmentCount: number;
  quarantinedAttachmentCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateAttachmentSummary {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  disposition: string;
  storageStatus: "approved" | "quarantined";
  quarantineReason: string | null;
}

export interface TemplateDetail extends TemplateSummary {
  versionId: string;
  htmlBody: string;
  textBody: string;
  sourceFileName: string | null;
  sanitization: Record<string, unknown>;
  versionCreatedAt: string;
  attachments: TemplateAttachmentSummary[];
  reviews: TemplateReviewSummary[];
}

export interface TemplateReviewSummary {
  id: string;
  versionId: string;
  requestedBy: string;
  reviewedBy: string | null;
  decision: "pending" | "approved" | "rejected";
  comment: string;
  requestedAt: string;
  reviewedAt: string | null;
}

interface GroupRow {
  id: string;
  name: string;
  description: string;
  recipient_count: number;
  created_at: string;
  updated_at: string;
}

interface RecipientRow {
  id: string;
  email: string;
  display_name: string;
  department: string;
  business_unit: string;
}

interface TemplateRow {
  id: string;
  name: string;
  status: TemplateSummary["status"];
  version_id: string;
  version_number: number;
  subject: string;
  html_body: string;
  text_body: string;
  source_type: TemplateSummary["sourceType"];
  source_file_name: string | null;
  sanitization_json: string;
  version_created_at: string;
  approved_attachment_count: number;
  quarantined_attachment_count: number;
  created_by: string;
  version_created_by: string;
  created_at: string;
  updated_at: string;
}

interface AttachmentRow {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  disposition: string;
  storage_status: "approved" | "quarantined";
  quarantine_reason: string | null;
}

export class ContentNotFoundError extends Error {}
export class ContentConflictError extends Error {}

function mapGroup(row: GroupRow): RecipientGroupSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    recipientCount: Number(row.recipient_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTemplate(row: TemplateRow): TemplateSummary {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    latestVersion: Number(row.version_number),
    subject: row.subject,
    sourceType: row.source_type,
    approvedAttachmentCount: Number(row.approved_attachment_count),
    quarantinedAttachmentCount: Number(row.quarantined_attachment_count),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ContentStore {
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
    actorUserId: string,
    action: string,
    objectType: string,
    objectId: string,
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

  listRecipientGroups(): RecipientGroupSummary[] {
    const rows = this.database
      .prepare(`
        SELECT g.id, g.name, g.description, g.created_at, g.updated_at,
               COUNT(m.recipient_id) AS recipient_count
        FROM recipient_groups g
        LEFT JOIN recipient_group_members m ON m.group_id = g.id
        GROUP BY g.id
        ORDER BY g.updated_at DESC, g.name COLLATE NOCASE
      `)
      .all() as unknown as GroupRow[];
    return rows.map(mapGroup);
  }

  createRecipientGroup(input: {
    id: string;
    name: string;
    nameNormalized: string;
    description: string;
    userId: string;
    occurredAt: string;
  }): RecipientGroupSummary {
    return this.transaction(() => {
      const duplicate = this.database
        .prepare("SELECT id FROM recipient_groups WHERE name_normalized = ?")
        .get(input.nameNormalized);
      if (duplicate) throw new ContentConflictError("同名名單群組已存在。");

      this.database
        .prepare(`
          INSERT INTO recipient_groups(
            id, name, name_normalized, description, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          input.id,
          input.name,
          input.nameNormalized,
          input.description,
          input.userId,
          input.occurredAt,
          input.occurredAt,
        );
      this.audit(input.occurredAt, input.userId, "recipient_group.created", "recipient_group", input.id, {});
      return {
        id: input.id,
        name: input.name,
        description: input.description,
        recipientCount: 0,
        createdAt: input.occurredAt,
        updatedAt: input.occurredAt,
      };
    });
  }

  getRecipientGroup(groupId: string): RecipientGroupDetail {
    const row = this.database
      .prepare(`
        SELECT g.id, g.name, g.description, g.created_at, g.updated_at,
               COUNT(m.recipient_id) AS recipient_count
        FROM recipient_groups g
        LEFT JOIN recipient_group_members m ON m.group_id = g.id
        WHERE g.id = ?
        GROUP BY g.id
      `)
      .get(groupId) as GroupRow | undefined;
    if (!row) throw new ContentNotFoundError("找不到指定名單群組。");

    const recipients = this.database
      .prepare(`
        SELECT r.id, r.email, r.display_name, r.department, r.business_unit
        FROM recipient_group_members m
        JOIN recipients r ON r.id = m.recipient_id
        WHERE m.group_id = ?
        ORDER BY r.business_unit COLLATE NOCASE, r.department COLLATE NOCASE,
                 r.display_name COLLATE NOCASE, r.email_normalized
        LIMIT 500
      `)
      .all(groupId) as unknown as RecipientRow[];

    return {
      ...mapGroup(row),
      recipients: recipients.map((recipient) => ({
        id: recipient.id,
        email: recipient.email,
        displayName: recipient.display_name,
        department: recipient.department,
        businessUnit: recipient.business_unit,
      })),
      recipientsTruncated: Number(row.recipient_count) > recipients.length,
    };
  }

  importRecipients(input: {
    groupId: string;
    recipients: RecipientRecordInput[];
    userId: string;
    occurredAt: string;
    quality: Record<string, unknown>;
  }): StoredRecipientImportResult {
    return this.transaction(() => {
      const group = this.database.prepare("SELECT id FROM recipient_groups WHERE id = ?").get(input.groupId);
      if (!group) throw new ContentNotFoundError("找不到指定名單群組。");

      const findRecipient = this.database.prepare(
        "SELECT id FROM recipients WHERE email_normalized = ?",
      );
      const insertRecipient = this.database.prepare(`
        INSERT INTO recipients(
          id, email, email_normalized, display_name, department,
          business_unit, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const updateRecipient = this.database.prepare(`
        UPDATE recipients
        SET email = ?, display_name = ?, department = ?, business_unit = ?, updated_at = ?
        WHERE id = ?
      `);
      const addMembership = this.database.prepare(`
        INSERT INTO recipient_group_members(group_id, recipient_id, added_at)
        VALUES (?, ?, ?)
        ON CONFLICT(group_id, recipient_id) DO NOTHING
      `);

      let insertedRecipients = 0;
      let updatedRecipients = 0;
      let addedMemberships = 0;
      for (const recipient of input.recipients) {
        const existing = findRecipient.get(recipient.emailNormalized) as { id: string } | undefined;
        const recipientId = existing?.id ?? recipient.id;
        if (existing) {
          updateRecipient.run(
            recipient.email,
            recipient.displayName,
            recipient.department,
            recipient.businessUnit,
            input.occurredAt,
            recipientId,
          );
          updatedRecipients += 1;
        } else {
          insertRecipient.run(
            recipientId,
            recipient.email,
            recipient.emailNormalized,
            recipient.displayName,
            recipient.department,
            recipient.businessUnit,
            input.occurredAt,
            input.occurredAt,
          );
          insertedRecipients += 1;
        }
        const membership = addMembership.run(input.groupId, recipientId, input.occurredAt);
        addedMemberships += Number(membership.changes);
      }

      this.database
        .prepare("UPDATE recipient_groups SET updated_at = ? WHERE id = ?")
        .run(input.occurredAt, input.groupId);
      this.audit(
        input.occurredAt,
        input.userId,
        "recipient_group.csv_imported",
        "recipient_group",
        input.groupId,
        {
          ...input.quality,
          acceptedRows: input.recipients.length,
          insertedRecipients,
          updatedRecipients,
          addedMemberships,
        },
      );
      return { insertedRecipients, updatedRecipients, addedMemberships };
    });
  }

  listTemplates(): TemplateSummary[] {
    const rows = this.database
      .prepare(this.templateSelectSql("ORDER BY t.updated_at DESC"))
      .all() as unknown as TemplateRow[];
    return rows.map(mapTemplate);
  }

  createTemplate(input: {
    id: string;
    name: string;
    version: TemplateVersionInput;
    userId: string;
    occurredAt: string;
  }): TemplateDetail {
    this.transaction(() => {
      this.database
        .prepare(`
          INSERT INTO email_templates(id, name, status, created_by, created_at, updated_at)
          VALUES (?, ?, 'draft', ?, ?, ?)
        `)
        .run(input.id, input.name, input.userId, input.occurredAt, input.occurredAt);
      this.insertTemplateVersion(input.id, 1, input.version, input.userId, input.occurredAt);
      this.audit(input.occurredAt, input.userId, "template.created", "email_template", input.id, {
        sourceType: input.version.sourceType,
        approvedAttachments: input.version.attachments.filter(
          (attachment) => attachment.storageStatus === "approved",
        ).length,
        quarantinedAttachments: input.version.attachments.filter(
          (attachment) => attachment.storageStatus === "quarantined",
        ).length,
      });
    });
    return this.getTemplate(input.id);
  }

  addTemplateVersion(input: {
    templateId: string;
    version: TemplateVersionInput;
    userId: string;
    occurredAt: string;
  }): TemplateDetail {
    this.transaction(() => {
      const template = this.database
        .prepare("SELECT id FROM email_templates WHERE id = ?")
        .get(input.templateId);
      if (!template) throw new ContentNotFoundError("找不到指定郵件範本。");
      const row = this.database
        .prepare(
          "SELECT COALESCE(MAX(version_number), 0) AS version_number FROM email_template_versions WHERE template_id = ?",
        )
        .get(input.templateId) as { version_number: number };
      const versionNumber = Number(row.version_number) + 1;
      this.insertTemplateVersion(
        input.templateId,
        versionNumber,
        input.version,
        input.userId,
        input.occurredAt,
      );
      this.database
        .prepare(`
          UPDATE template_reviews
          SET decision = 'rejected', comment = '已有新版本，原審核申請自動失效。', reviewed_at = ?
          WHERE template_id = ? AND decision = 'pending'
        `)
        .run(input.occurredAt, input.templateId);
      this.database
        .prepare("UPDATE email_templates SET status = 'draft', updated_at = ? WHERE id = ?")
        .run(input.occurredAt, input.templateId);
      this.audit(
        input.occurredAt,
        input.userId,
        "template.version_created",
        "email_template",
        input.templateId,
        { versionNumber },
      );
    });
    return this.getTemplate(input.templateId);
  }

  private insertTemplateVersion(
    templateId: string,
    versionNumber: number,
    version: TemplateVersionInput,
    userId: string,
    occurredAt: string,
  ): void {
    this.database
      .prepare(`
        INSERT INTO email_template_versions(
          id, template_id, version_number, subject, html_body, text_body,
          source_type, source_file_name, sanitization_json, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        version.id,
        templateId,
        versionNumber,
        version.subject,
        version.htmlBody,
        version.textBody,
        version.sourceType,
        version.sourceFileName,
        JSON.stringify(version.sanitization),
        userId,
        occurredAt,
      );
    const insertAttachment = this.database.prepare(`
      INSERT INTO template_attachments(
        id, version_id, file_name, mime_type, size_bytes, sha256,
        disposition, storage_status, quarantine_reason, content_blob, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const attachment of version.attachments) {
      insertAttachment.run(
        attachment.id,
        version.id,
        attachment.fileName,
        attachment.mimeType,
        attachment.sizeBytes,
        attachment.sha256,
        attachment.disposition,
        attachment.storageStatus,
        attachment.quarantineReason,
        attachment.content,
        occurredAt,
      );
    }
  }

  getTemplate(templateId: string): TemplateDetail {
    const row = this.database
      .prepare(this.templateSelectSql("WHERE t.id = ?"))
      .get(templateId) as TemplateRow | undefined;
    if (!row) throw new ContentNotFoundError("找不到指定郵件範本。");
    const attachmentRows = this.database
      .prepare(`
        SELECT id, file_name, mime_type, size_bytes, sha256, disposition,
               storage_status, quarantine_reason
        FROM template_attachments
        WHERE version_id = ?
        ORDER BY file_name COLLATE NOCASE
      `)
      .all(row.version_id) as unknown as AttachmentRow[];
    const reviewRows = this.database
      .prepare(`
        SELECT id, version_id, requested_by, reviewed_by, decision, comment,
               requested_at, reviewed_at
        FROM template_reviews
        WHERE template_id = ?
        ORDER BY requested_at DESC
      `)
      .all(templateId) as unknown as Array<{
        id: string;
        version_id: string;
        requested_by: string;
        reviewed_by: string | null;
        decision: TemplateReviewSummary["decision"];
        comment: string;
        requested_at: string;
        reviewed_at: string | null;
      }>;

    return {
      ...mapTemplate(row),
      versionId: row.version_id,
      htmlBody: row.html_body,
      textBody: row.text_body,
      sourceFileName: row.source_file_name,
      sanitization: JSON.parse(row.sanitization_json) as Record<string, unknown>,
      versionCreatedAt: row.version_created_at,
      attachments: attachmentRows.map((attachment) => ({
        id: attachment.id,
        fileName: attachment.file_name,
        mimeType: attachment.mime_type,
        sizeBytes: Number(attachment.size_bytes),
        sha256: attachment.sha256,
        disposition: attachment.disposition,
        storageStatus: attachment.storage_status,
        quarantineReason: attachment.quarantine_reason,
      })),
      reviews: reviewRows.map((review) => ({
        id: review.id,
        versionId: review.version_id,
        requestedBy: review.requested_by,
        reviewedBy: review.reviewed_by,
        decision: review.decision,
        comment: review.comment,
        requestedAt: review.requested_at,
        reviewedAt: review.reviewed_at,
      })),
    };
  }

  submitTemplateReview(input: {
    reviewId: string;
    templateId: string;
    userId: string;
    comment: string;
    occurredAt: string;
  }): TemplateDetail {
    this.transaction(() => {
      const row = this.database
        .prepare(`
          SELECT t.status, v.id AS version_id
          FROM email_templates t
          JOIN email_template_versions v ON v.id = (
            SELECT latest.id FROM email_template_versions latest
            WHERE latest.template_id = t.id
            ORDER BY latest.version_number DESC LIMIT 1
          )
          WHERE t.id = ?
        `)
        .get(input.templateId) as { status: TemplateSummary["status"]; version_id: string } | undefined;
      if (!row) throw new ContentNotFoundError("找不到指定郵件範本。");
      if (row.status !== "draft" && row.status !== "pending_review") {
        throw new ContentConflictError("只有 Draft 範本可送交審核。");
      }
      const pending = this.database
        .prepare("SELECT id FROM template_reviews WHERE template_id = ? AND decision = 'pending'")
        .get(input.templateId);
      if (pending) throw new ContentConflictError("此範本已有待處理的審核申請。");
      this.database
        .prepare(`
          INSERT INTO template_reviews(
            id, template_id, version_id, requested_by, reviewed_by,
            decision, comment, requested_at, reviewed_at
          ) VALUES (?, ?, ?, ?, NULL, 'pending', ?, ?, NULL)
        `)
        .run(
          input.reviewId,
          input.templateId,
          row.version_id,
          input.userId,
          input.comment,
          input.occurredAt,
        );
      this.database
        .prepare("UPDATE email_templates SET status = 'pending_review', updated_at = ? WHERE id = ?")
        .run(input.occurredAt, input.templateId);
      this.audit(input.occurredAt, input.userId, "template.review_requested", "email_template", input.templateId, {
        reviewId: input.reviewId,
        versionId: row.version_id,
      });
    });
    return this.getTemplate(input.templateId);
  }

  decideTemplateReview(input: {
    templateId: string;
    reviewId: string;
    reviewerId: string;
    decision: "approved" | "rejected";
    comment: string;
    occurredAt: string;
  }): TemplateDetail {
    this.transaction(() => {
      const row = this.database
        .prepare(`
          SELECT r.requested_by, r.version_id, r.decision,
                 v.created_by AS version_created_by
          FROM template_reviews r
          JOIN email_template_versions v ON v.id = r.version_id
          WHERE r.id = ? AND r.template_id = ?
        `)
        .get(input.reviewId, input.templateId) as
        | { requested_by: string; version_id: string; decision: string; version_created_by: string }
        | undefined;
      if (!row) throw new ContentNotFoundError("找不到指定範本審核申請。");
      if (row.decision !== "pending") throw new ContentConflictError("此審核申請已完成。");
      if (row.requested_by === input.reviewerId || row.version_created_by === input.reviewerId) {
        throw new ContentConflictError("範本製作者或送審者不可審核自己的範本。");
      }
      const latest = this.database
        .prepare(`
          SELECT id FROM email_template_versions
          WHERE template_id = ? ORDER BY version_number DESC LIMIT 1
        `)
        .get(input.templateId) as { id: string } | undefined;
      if (!latest || latest.id !== row.version_id) {
        throw new ContentConflictError("範本已有新版本，請重新送審。");
      }
      this.database
        .prepare(`
          UPDATE template_reviews
          SET reviewed_by = ?, decision = ?, comment = ?, reviewed_at = ?
          WHERE id = ?
        `)
        .run(input.reviewerId, input.decision, input.comment, input.occurredAt, input.reviewId);
      this.database
        .prepare("UPDATE email_templates SET status = ?, updated_at = ? WHERE id = ?")
        .run(input.decision === "approved" ? "approved" : "draft", input.occurredAt, input.templateId);
      this.audit(input.occurredAt, input.reviewerId, `template.${input.decision}`, "email_template", input.templateId, {
        reviewId: input.reviewId,
        versionId: row.version_id,
      });
    });
    return this.getTemplate(input.templateId);
  }

  getTemplatePreview(templateId: string): { subject: string; htmlBody: string } {
    const row = this.database
      .prepare(`
        SELECT v.subject, v.html_body
        FROM email_templates t
        JOIN email_template_versions v ON v.template_id = t.id
        WHERE t.id = ?
        ORDER BY v.version_number DESC
        LIMIT 1
      `)
      .get(templateId) as { subject: string; html_body: string } | undefined;
    if (!row) throw new ContentNotFoundError("找不到指定郵件範本。");
    return { subject: row.subject, htmlBody: row.html_body };
  }

  private templateSelectSql(suffix: string): string {
    return `
      SELECT t.id, t.name, t.status, t.created_by, t.created_at, t.updated_at,
             v.id AS version_id, v.version_number, v.subject, v.html_body,
             v.text_body, v.source_type, v.source_file_name,
             v.sanitization_json, v.created_by AS version_created_by,
             v.created_at AS version_created_at,
             (SELECT COUNT(*) FROM template_attachments a
              WHERE a.version_id = v.id AND a.storage_status = 'approved')
               AS approved_attachment_count,
             (SELECT COUNT(*) FROM template_attachments a
              WHERE a.version_id = v.id AND a.storage_status = 'quarantined')
               AS quarantined_attachment_count
      FROM email_templates t
      JOIN email_template_versions v ON v.id = (
        SELECT latest.id
        FROM email_template_versions latest
        WHERE latest.template_id = t.id
        ORDER BY latest.version_number DESC
        LIMIT 1
      )
      ${suffix}
    `;
  }
}
