import type { DatabaseSync } from "node:sqlite";

export interface ReportRecipient {
  email: string;
  recipientName: string;
  department: string;
  businessUnit: string;
  deliveryStatus: string;
}

export interface ReportArtifact {
  id: string;
  campaignId: string | null;
  externalJobId: string | null;
  format: "xlsx" | "docx" | "json";
  fileName: string;
  filePath: string;
  sha256: string;
  sizeBytes: number;
  createdAt: string;
}

export class ReportArtifactNotFoundError extends Error {}

export class ReportStore {
  constructor(private readonly database: DatabaseSync) {}

  campaignRecipients(campaignId: string): ReportRecipient[] {
    return this.database
      .prepare(`
        SELECT ct.email_snapshot AS email,
               ct.display_name_snapshot AS display_name,
               ct.department_snapshot AS department,
               ct.business_unit_snapshot AS business_unit,
               COALESCE(d.status, 'not_scheduled') AS delivery_status
        FROM campaign_targets ct
        LEFT JOIN deliveries d ON d.campaign_target_id = ct.id
        WHERE ct.campaign_id = ?
        ORDER BY ct.business_unit_snapshot, ct.department_snapshot,
                 ct.display_name_snapshot, lower(ct.email_snapshot)
      `)
      .all(campaignId)
      .map((value) => {
        const row = value as Record<string, unknown>;
        return {
          email: String(row.email ?? ""),
          recipientName: String(row.display_name ?? ""),
          department: String(row.department ?? ""),
          businessUnit: String(row.business_unit ?? ""),
          deliveryStatus: String(row.delivery_status ?? ""),
        };
      });
  }

  totalArtifactCount(): number {
    const row = this.database.prepare("SELECT COUNT(*) AS count FROM report_artifacts").get() as {
      count: number;
    };
    return Number(row.count);
  }

  listArtifacts(limit = 200): ReportArtifact[] {
    return (this.database
      .prepare(`
        SELECT id, campaign_id, external_job_id, format, file_name, file_path,
               sha256, size_bytes, created_at
        FROM report_artifacts ORDER BY created_at DESC LIMIT ?
      `)
      .all(Math.max(1, Math.min(limit, 200))) as unknown as Array<{
        id: string;
        campaign_id: string | null;
        external_job_id: string | null;
        format: ReportArtifact["format"];
        file_name: string;
        file_path: string;
        sha256: string;
        size_bytes: number;
        created_at: string;
      }>).map((row) => ({
        id: row.id,
        campaignId: row.campaign_id,
        externalJobId: row.external_job_id,
        format: row.format,
        fileName: row.file_name,
        filePath: row.file_path,
        sha256: row.sha256,
        sizeBytes: Number(row.size_bytes),
        createdAt: row.created_at,
      }));
  }

  createExternalJob(input: {
    id: string;
    sourceFileName: string;
    targetCount: number | null;
    userId: string;
    occurredAt: string;
  }): void {
    this.database
      .prepare(`
        INSERT INTO external_report_jobs(id, source_file_name, target_count, created_by, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(input.id, input.sourceFileName, input.targetCount, input.userId, input.occurredAt);
    this.audit(input.occurredAt, input.userId, "report.external_job_created", "external_report_job", input.id, {
      sourceFileName: input.sourceFileName,
      targetCount: input.targetCount,
    });
  }

  saveArtifact(input: {
    id: string;
    campaignId: string | null;
    externalJobId: string | null;
    format: ReportArtifact["format"];
    fileName: string;
    filePath: string;
    sha256: string;
    sizeBytes: number;
    userId: string;
    occurredAt: string;
  }): ReportArtifact {
    this.database
      .prepare(`
        INSERT INTO report_artifacts(
          id, campaign_id, external_job_id, format, file_name, file_path,
          sha256, size_bytes, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.id,
        input.campaignId,
        input.externalJobId,
        input.format,
        input.fileName,
        input.filePath,
        input.sha256,
        input.sizeBytes,
        input.userId,
        input.occurredAt,
      );
    this.audit(input.occurredAt, input.userId, "report.artifact_created", "report_artifact", input.id, {
      format: input.format,
      sha256: input.sha256,
      sizeBytes: input.sizeBytes,
    });
    return this.getArtifact(input.id);
  }

  getArtifact(artifactId: string): ReportArtifact {
    const row = this.database
      .prepare(`
        SELECT id, campaign_id, external_job_id, format, file_name, file_path,
               sha256, size_bytes, created_at
        FROM report_artifacts WHERE id = ?
      `)
      .get(artifactId) as
      | {
          id: string;
          campaign_id: string | null;
          external_job_id: string | null;
          format: ReportArtifact["format"];
          file_name: string;
          file_path: string;
          sha256: string;
          size_bytes: number;
          created_at: string;
        }
      | undefined;
    if (!row) throw new ReportArtifactNotFoundError("找不到指定報表檔案。");
    return {
      id: row.id,
      campaignId: row.campaign_id,
      externalJobId: row.external_job_id,
      format: row.format,
      fileName: row.file_name,
      filePath: row.file_path,
      sha256: row.sha256,
      sizeBytes: Number(row.size_bytes),
      createdAt: row.created_at,
    };
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
}
