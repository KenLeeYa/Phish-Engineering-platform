import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { PlatformSettings } from "../domain/settings.js";

export type AccessRole = "system_admin" | "campaign_creator" | "reviewer" | "report_viewer";

export interface StoredUser {
  id: string;
  username: string;
  usernameNormalized: string;
  displayName: string;
  passwordHash: string;
  role: AccessRole;
  status: "active" | "disabled";
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface StoredSession {
  sessionHash: string;
  csrfHash: string;
  expiresAt: string;
  user: StoredUser;
}

export interface InitialPlatformData {
  user: StoredUser;
  settings: PlatformSettings;
  occurredAt: string;
}

interface UserRow {
  id: string;
  username: string;
  username_normalized: string;
  display_name: string;
  password_hash: string;
  role: "system_admin";
  access_role: AccessRole;
  status: "active" | "disabled";
  must_change_password: number;
  created_at: string;
  last_login_at: string | null;
}

interface SessionRow extends UserRow {
  session_hash: string;
  csrf_hash: string;
  expires_at: string;
}

export class PlatformAlreadyInitializedError extends Error {}
export class UserAlreadyExistsError extends Error {}

export interface AuditRecord {
  id: number;
  occurredAt: string;
  actorUserId: string | null;
  action: string;
  objectType: string;
  objectId: string | null;
  metadata: Record<string, unknown>;
}

function mapUser(row: UserRow): StoredUser {
  return {
    id: row.id,
    username: row.username,
    usernameNormalized: row.username_normalized,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    role: row.access_role,
    status: row.status,
    mustChangePassword: Boolean(row.must_change_password),
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

export class PlatformStore {
  readonly database: DatabaseSync;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA busy_timeout = 5000");
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA synchronous = NORMAL");
    this.database.exec("PRAGMA secure_delete = ON");
    this.migrate();
  }

  close(): void {
    this.database.close();
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);
    if (!this.hasMigration(1)) this.applyMigration1();
    if (!this.hasMigration(2)) this.applyMigration2();
    if (!this.hasMigration(3)) this.applyMigration3();
    if (!this.hasMigration(4)) this.applyMigration4();
  }

  private hasMigration(version: number): boolean {
    return Boolean(
      this.database
        .prepare("SELECT version FROM schema_migrations WHERE version = ?")
        .get(version),
    );
  }

  private applyMigration1(): void {
    this.transaction(() => {
      this.database.exec(`
        CREATE TABLE app_users (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          username_normalized TEXT NOT NULL COLLATE NOCASE UNIQUE,
          display_name TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('system_admin')),
          status TEXT NOT NULL CHECK (status IN ('active')),
          created_at TEXT NOT NULL,
          last_login_at TEXT
        ) STRICT;

        CREATE TABLE auth_sessions (
          session_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          csrf_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL
        ) STRICT;

        CREATE INDEX auth_sessions_expires_at_idx ON auth_sessions(expires_at);

        CREATE TABLE platform_settings (
          setting_key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          updated_by TEXT NOT NULL REFERENCES app_users(id)
        ) STRICT;

        CREATE TABLE audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          occurred_at TEXT NOT NULL,
          actor_user_id TEXT REFERENCES app_users(id),
          action TEXT NOT NULL,
          object_type TEXT NOT NULL,
          object_id TEXT,
          metadata_json TEXT NOT NULL
        ) STRICT;

        CREATE INDEX audit_log_occurred_at_idx ON audit_log(occurred_at DESC);
        INSERT INTO schema_migrations(version, applied_at) VALUES (1, CURRENT_TIMESTAMP);
      `);
    });
  }

  private applyMigration2(): void {
    this.transaction(() => {
      this.database.exec(`
        CREATE TABLE recipient_groups (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          name_normalized TEXT NOT NULL COLLATE NOCASE UNIQUE,
          description TEXT NOT NULL,
          created_by TEXT NOT NULL REFERENCES app_users(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE recipients (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          email_normalized TEXT NOT NULL COLLATE NOCASE UNIQUE,
          display_name TEXT NOT NULL,
          department TEXT NOT NULL,
          business_unit TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE recipient_group_members (
          group_id TEXT NOT NULL REFERENCES recipient_groups(id) ON DELETE CASCADE,
          recipient_id TEXT NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
          added_at TEXT NOT NULL,
          PRIMARY KEY (group_id, recipient_id)
        ) STRICT;

        CREATE INDEX recipient_group_members_recipient_idx
          ON recipient_group_members(recipient_id);

        CREATE TABLE email_templates (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('draft', 'pending_review', 'approved', 'archived')),
          created_by TEXT NOT NULL REFERENCES app_users(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE email_template_versions (
          id TEXT PRIMARY KEY,
          template_id TEXT NOT NULL REFERENCES email_templates(id) ON DELETE CASCADE,
          version_number INTEGER NOT NULL CHECK (version_number > 0),
          subject TEXT NOT NULL,
          html_body TEXT NOT NULL,
          text_body TEXT NOT NULL,
          source_type TEXT NOT NULL CHECK (source_type IN ('manual', 'eml_import')),
          source_file_name TEXT,
          sanitization_json TEXT NOT NULL,
          created_by TEXT NOT NULL REFERENCES app_users(id),
          created_at TEXT NOT NULL,
          UNIQUE (template_id, version_number)
        ) STRICT;

        CREATE INDEX email_template_versions_template_idx
          ON email_template_versions(template_id, version_number DESC);

        CREATE TABLE template_attachments (
          id TEXT PRIMARY KEY,
          version_id TEXT NOT NULL REFERENCES email_template_versions(id) ON DELETE CASCADE,
          file_name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
          sha256 TEXT NOT NULL,
          disposition TEXT NOT NULL,
          storage_status TEXT NOT NULL CHECK (storage_status IN ('approved', 'quarantined')),
          quarantine_reason TEXT,
          content_blob BLOB,
          created_at TEXT NOT NULL
        ) STRICT;

        CREATE INDEX template_attachments_version_idx
          ON template_attachments(version_id);

        INSERT INTO schema_migrations(version, applied_at) VALUES (2, CURRENT_TIMESTAMP);
      `);
    });
  }

  private applyMigration3(): void {
    this.transaction(() => {
      this.database.exec(`
        ALTER TABLE app_users ADD COLUMN access_role TEXT NOT NULL DEFAULT 'system_admin'
          CHECK (access_role IN ('system_admin', 'campaign_creator', 'reviewer', 'report_viewer'));

        CREATE TABLE template_reviews (
          id TEXT PRIMARY KEY,
          template_id TEXT NOT NULL REFERENCES email_templates(id) ON DELETE CASCADE,
          version_id TEXT NOT NULL REFERENCES email_template_versions(id) ON DELETE CASCADE,
          requested_by TEXT NOT NULL REFERENCES app_users(id),
          reviewed_by TEXT REFERENCES app_users(id),
          decision TEXT NOT NULL CHECK (decision IN ('pending', 'approved', 'rejected')),
          comment TEXT NOT NULL,
          requested_at TEXT NOT NULL,
          reviewed_at TEXT
        ) STRICT;

        CREATE INDEX template_reviews_template_idx
          ON template_reviews(template_id, requested_at DESC);

        CREATE TABLE mail_connectors (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          connector_type TEXT NOT NULL CHECK (connector_type IN ('pickup', 'smtp')),
          sender_email TEXT NOT NULL,
          sender_name TEXT NOT NULL,
          config_json TEXT NOT NULL,
          secret_ref TEXT,
          status TEXT NOT NULL CHECK (status IN ('draft', 'ready', 'disabled')),
          verified_at TEXT,
          created_by TEXT NOT NULL REFERENCES app_users(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE campaigns (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          template_id TEXT NOT NULL REFERENCES email_templates(id),
          template_version_id TEXT NOT NULL REFERENCES email_template_versions(id),
          recipient_group_id TEXT NOT NULL REFERENCES recipient_groups(id),
          connector_id TEXT NOT NULL REFERENCES mail_connectors(id),
          status TEXT NOT NULL CHECK (status IN (
            'draft', 'pending_review', 'approved', 'scheduled', 'running',
            'paused', 'completed', 'cancelled'
          )),
          scheduled_at TEXT,
          send_window_start TEXT NOT NULL,
          send_window_end TEXT NOT NULL,
          throttle_per_minute INTEGER NOT NULL CHECK (throttle_per_minute BETWEEN 1 AND 600),
          base_url TEXT NOT NULL,
          test_only INTEGER NOT NULL CHECK (test_only IN (0, 1)),
          created_by TEXT NOT NULL REFERENCES app_users(id),
          approved_by TEXT REFERENCES app_users(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE campaign_reviews (
          id TEXT PRIMARY KEY,
          campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          requested_by TEXT NOT NULL REFERENCES app_users(id),
          reviewed_by TEXT REFERENCES app_users(id),
          decision TEXT NOT NULL CHECK (decision IN ('pending', 'approved', 'rejected')),
          comment TEXT NOT NULL,
          requested_at TEXT NOT NULL,
          reviewed_at TEXT
        ) STRICT;

        CREATE TABLE campaign_targets (
          id TEXT PRIMARY KEY,
          campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          recipient_id TEXT NOT NULL REFERENCES recipients(id),
          tracking_token_hash TEXT NOT NULL UNIQUE,
          tracking_token TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE (campaign_id, recipient_id)
        ) STRICT;

        CREATE TABLE deliveries (
          id TEXT PRIMARY KEY,
          campaign_target_id TEXT NOT NULL REFERENCES campaign_targets(id) ON DELETE CASCADE UNIQUE,
          status TEXT NOT NULL CHECK (status IN (
            'queued', 'sending', 'sent', 'failed', 'suppressed', 'cancelled'
          )),
          attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 10),
          next_attempt_at TEXT NOT NULL,
          sent_at TEXT,
          last_error_code TEXT,
          last_error_message TEXT,
          message_id TEXT,
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE INDEX deliveries_queue_idx
          ON deliveries(status, next_attempt_at);

        CREATE TABLE suppression_list (
          email_normalized TEXT PRIMARY KEY COLLATE NOCASE,
          reason TEXT NOT NULL,
          created_by TEXT NOT NULL REFERENCES app_users(id),
          created_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE simulation_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          campaign_target_id TEXT NOT NULL REFERENCES campaign_targets(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL CHECK (event_type IN (
            'email_opened', 'link_clicked', 'attachment_opened',
            'training_viewed', 'training_acknowledged', 'delivery_bounced'
          )),
          attachment_id TEXT REFERENCES template_attachments(id),
          source TEXT NOT NULL CHECK (source IN ('tracking_endpoint', 'controlled_attachment', 'audit_import', 'mail_connector')),
          actor_class TEXT NOT NULL CHECK (actor_class IN ('human_likely', 'automated_likely', 'unknown')),
          confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
          client_fingerprint_hash TEXT,
          metadata_json TEXT NOT NULL,
          occurred_at TEXT NOT NULL
        ) STRICT;

        CREATE INDEX simulation_events_target_idx
          ON simulation_events(campaign_target_id, occurred_at);

        CREATE TABLE external_report_jobs (
          id TEXT PRIMARY KEY,
          source_file_name TEXT NOT NULL,
          target_count INTEGER,
          created_by TEXT NOT NULL REFERENCES app_users(id),
          created_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE report_artifacts (
          id TEXT PRIMARY KEY,
          campaign_id TEXT REFERENCES campaigns(id) ON DELETE CASCADE,
          external_job_id TEXT REFERENCES external_report_jobs(id) ON DELETE CASCADE,
          format TEXT NOT NULL CHECK (format IN ('xlsx', 'docx', 'json')),
          file_name TEXT NOT NULL,
          file_path TEXT NOT NULL,
          sha256 TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          created_by TEXT NOT NULL REFERENCES app_users(id),
          created_at TEXT NOT NULL,
          CHECK ((campaign_id IS NOT NULL) != (external_job_id IS NOT NULL))
        ) STRICT;

        CREATE TABLE platform_controls (
          control_key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_by TEXT NOT NULL REFERENCES app_users(id),
          updated_at TEXT NOT NULL
        ) STRICT;

        INSERT INTO platform_controls(control_key, value_json, updated_by, updated_at)
          SELECT 'delivery', '{"emergencyStop":false}', id, CURRENT_TIMESTAMP
          FROM app_users ORDER BY created_at LIMIT 1;

        INSERT INTO schema_migrations(version, applied_at) VALUES (3, CURRENT_TIMESTAMP);
      `);
    });
  }

  private applyMigration4(): void {
    this.transaction(() => {
      this.database.exec(`
        ALTER TABLE app_users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'active'
          CHECK (account_status IN ('active', 'disabled'));
        ALTER TABLE app_users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0
          CHECK (must_change_password IN (0, 1));

        ALTER TABLE campaign_reviews ADD COLUMN approval_digest TEXT;

        CREATE TABLE campaign_review_recipients (
          review_id TEXT NOT NULL REFERENCES campaign_reviews(id) ON DELETE CASCADE,
          recipient_id TEXT NOT NULL REFERENCES recipients(id),
          email TEXT NOT NULL,
          display_name TEXT NOT NULL,
          department TEXT NOT NULL,
          business_unit TEXT NOT NULL,
          PRIMARY KEY (review_id, recipient_id)
        ) STRICT;

        ALTER TABLE campaign_targets ADD COLUMN email_snapshot TEXT NOT NULL DEFAULT '';
        ALTER TABLE campaign_targets ADD COLUMN display_name_snapshot TEXT NOT NULL DEFAULT '';
        ALTER TABLE campaign_targets ADD COLUMN department_snapshot TEXT NOT NULL DEFAULT '';
        ALTER TABLE campaign_targets ADD COLUMN business_unit_snapshot TEXT NOT NULL DEFAULT '';
        ALTER TABLE campaign_targets ADD COLUMN valid_from TEXT;
        ALTER TABLE campaign_targets ADD COLUMN expires_at TEXT;
        ALTER TABLE campaign_targets ADD COLUMN revoked_at TEXT;

        UPDATE campaign_targets
        SET email_snapshot = COALESCE((SELECT email FROM recipients WHERE id = recipient_id), ''),
            display_name_snapshot = COALESCE((SELECT display_name FROM recipients WHERE id = recipient_id), ''),
            department_snapshot = COALESCE((SELECT department FROM recipients WHERE id = recipient_id), ''),
            business_unit_snapshot = COALESCE((SELECT business_unit FROM recipients WHERE id = recipient_id), ''),
            valid_from = created_at,
            expires_at = datetime(created_at, '+90 days');

        ALTER TABLE simulation_events ADD COLUMN dedupe_key TEXT;
        CREATE UNIQUE INDEX simulation_events_target_dedupe_idx
          ON simulation_events(campaign_target_id, dedupe_key)
          WHERE dedupe_key IS NOT NULL;

        INSERT INTO schema_migrations(version, applied_at) VALUES (4, CURRENT_TIMESTAMP);
      `);
    });
  }

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

  isSetupRequired(): boolean {
    const row = this.database.prepare("SELECT COUNT(*) AS count FROM app_users").get() as
      | { count: number }
      | undefined;
    return Number(row?.count ?? 0) === 0;
  }

  initializePlatform(data: InitialPlatformData): void {
    this.transaction(() => {
      if (!this.isSetupRequired()) throw new PlatformAlreadyInitializedError();
      this.database
        .prepare(`
          INSERT INTO app_users(
            id, username, username_normalized, display_name, password_hash,
            role, status, created_at, last_login_at, access_role
          ) VALUES (?, ?, ?, ?, ?, 'system_admin', ?, ?, NULL, ?)
        `)
        .run(
          data.user.id,
          data.user.username,
          data.user.usernameNormalized,
          data.user.displayName,
          data.user.passwordHash,
          data.user.status,
          data.user.createdAt,
          data.user.role,
        );
      this.database
        .prepare(`
          INSERT INTO platform_settings(setting_key, value_json, updated_at, updated_by)
          VALUES ('platform', ?, ?, ?)
        `)
        .run(JSON.stringify(data.settings), data.occurredAt, data.user.id);
      this.insertAudit(
        data.occurredAt,
        data.user.id,
        "platform.initialized",
        "platform",
        "local",
        { phase: 1 },
      );
    });
  }

  findUserByNormalizedUsername(username: string): StoredUser | null {
    const row = this.database
      .prepare(`
        SELECT id, username, username_normalized, display_name, password_hash,
               role, access_role, account_status AS status, must_change_password,
               created_at, last_login_at
        FROM app_users
        WHERE username_normalized = ? AND account_status = 'active'
      `)
      .get(username) as UserRow | undefined;
    return row ? mapUser(row) : null;
  }

  listUsers(): StoredUser[] {
    const rows = this.database
      .prepare(`
        SELECT id, username, username_normalized, display_name, password_hash,
               role, access_role, account_status AS status, must_change_password,
               created_at, last_login_at
        FROM app_users
        ORDER BY created_at, username_normalized
      `)
      .all() as unknown as UserRow[];
    return rows.map(mapUser);
  }

  createUser(user: StoredUser, actorUserId: string, occurredAt: string): void {
    this.transaction(() => {
      const existing = this.database
        .prepare("SELECT id FROM app_users WHERE username_normalized = ?")
        .get(user.usernameNormalized);
      if (existing) throw new UserAlreadyExistsError();
      this.database
        .prepare(`
          INSERT INTO app_users(
            id, username, username_normalized, display_name, password_hash,
            role, status, created_at, last_login_at, access_role, must_change_password
          ) VALUES (?, ?, ?, ?, ?, 'system_admin', 'active', ?, NULL, ?, 1)
        `)
        .run(
          user.id,
          user.username,
          user.usernameNormalized,
          user.displayName,
          user.passwordHash,
          user.createdAt,
          user.role,
        );
      this.insertAudit(occurredAt, actorUserId, "user.created", "user", user.id, {
        accessRole: user.role,
      });
    });
  }

  createSession(input: {
    sessionHash: string;
    csrfHash: string;
    userId: string;
    createdAt: string;
    expiresAt: string;
  }): void {
    this.database
      .prepare(`
        INSERT INTO auth_sessions(
          session_hash, user_id, csrf_hash, created_at, expires_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.sessionHash,
        input.userId,
        input.csrfHash,
        input.createdAt,
        input.expiresAt,
        input.createdAt,
      );
  }

  findSession(sessionHash: string, now: string): StoredSession | null {
    const row = this.database
      .prepare(`
        SELECT s.session_hash, s.csrf_hash, s.expires_at,
               u.id, u.username, u.username_normalized, u.display_name,
               u.password_hash, u.role, u.access_role, u.account_status AS status,
               u.must_change_password, u.created_at, u.last_login_at
        FROM auth_sessions s
        JOIN app_users u ON u.id = s.user_id
        WHERE s.session_hash = ? AND s.expires_at > ? AND u.account_status = 'active'
      `)
      .get(sessionHash, now) as SessionRow | undefined;
    if (!row) return null;
    return {
      sessionHash: row.session_hash,
      csrfHash: row.csrf_hash,
      expiresAt: row.expires_at,
      user: mapUser(row),
    };
  }

  deleteSession(sessionHash: string): void {
    this.database.prepare("DELETE FROM auth_sessions WHERE session_hash = ?").run(sessionHash);
  }

  deleteUserSessions(userId: string): number {
    return Number(this.database.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(userId).changes);
  }

  updateUserAccess(input: {
    userId: string;
    role: AccessRole;
    status: "active" | "disabled";
    actorUserId: string;
    occurredAt: string;
  }): StoredUser {
    return this.transaction(() => {
      const current = this.database
        .prepare("SELECT access_role, account_status FROM app_users WHERE id = ?")
        .get(input.userId) as
        | { access_role: AccessRole; account_status: "active" | "disabled" }
        | undefined;
      if (!current) throw new Error("USER_NOT_FOUND");
      const removesActiveAdmin =
        current.access_role === "system_admin" &&
        current.account_status === "active" &&
        (input.role !== "system_admin" || input.status !== "active");
      if (removesActiveAdmin) {
        const row = this.database
          .prepare("SELECT COUNT(*) AS count FROM app_users WHERE access_role = 'system_admin' AND account_status = 'active'")
          .get() as { count: number };
        if (Number(row.count) <= 1) throw new Error("LAST_ADMIN");
      }
      this.database
        .prepare("UPDATE app_users SET access_role = ?, account_status = ? WHERE id = ?")
        .run(input.role, input.status, input.userId);
      this.database.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(input.userId);
      this.insertAudit(input.occurredAt, input.actorUserId, "user.access_updated", "user", input.userId, {
        accessRole: input.role,
        status: input.status,
      });
      const updated = this.database.prepare(`
        SELECT id, username, username_normalized, display_name, password_hash,
               role, access_role, account_status AS status, must_change_password,
               created_at, last_login_at
        FROM app_users WHERE id = ?
      `).get(input.userId) as unknown as UserRow;
      return mapUser(updated);
    });
  }

  updateUserPassword(input: {
    userId: string;
    passwordHash: string;
    mustChangePassword: boolean;
    actorUserId: string;
    occurredAt: string;
  }): void {
    this.transaction(() => {
      const result = this.database.prepare(`
        UPDATE app_users SET password_hash = ?, must_change_password = ? WHERE id = ?
      `).run(input.passwordHash, input.mustChangePassword ? 1 : 0, input.userId);
      if (!result.changes) throw new Error("USER_NOT_FOUND");
      this.database.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(input.userId);
      this.insertAudit(input.occurredAt, input.actorUserId, "user.password_changed", "user", input.userId, {
        forcedChangeRequired: input.mustChangePassword,
      });
    });
  }

  deleteExpiredSessions(now: string): void {
    this.database.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(now);
  }

  recordSuccessfulLogin(userId: string, occurredAt: string): void {
    this.transaction(() => {
      this.database.prepare("UPDATE app_users SET last_login_at = ? WHERE id = ?").run(occurredAt, userId);
      this.insertAudit(occurredAt, userId, "auth.login_succeeded", "user", userId, {});
    });
  }

  appendAudit(
    occurredAt: string,
    actorUserId: string | null,
    action: string,
    objectType: string,
    objectId: string | null,
    metadata: Record<string, unknown>,
  ): void {
    this.insertAudit(occurredAt, actorUserId, action, objectType, objectId, metadata);
  }

  private insertAudit(
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

  getSettings(): PlatformSettings | null {
    const row = this.database
      .prepare("SELECT value_json FROM platform_settings WHERE setting_key = 'platform'")
      .get() as { value_json: string } | undefined;
    return row ? (JSON.parse(row.value_json) as PlatformSettings) : null;
  }

  updateSettings(
    settings: PlatformSettings,
    userId: string,
    occurredAt: string,
    changedFields: string[],
  ): void {
    this.transaction(() => {
      this.database
        .prepare(`
          UPDATE platform_settings
          SET value_json = ?, updated_at = ?, updated_by = ?
          WHERE setting_key = 'platform'
        `)
        .run(JSON.stringify(settings), occurredAt, userId);
      this.insertAudit(occurredAt, userId, "settings.updated", "platform", "local", {
        changedFields,
      });
    });
  }

  getDeliveryControl(): { emergencyStop: boolean } {
    const row = this.database
      .prepare("SELECT value_json FROM platform_controls WHERE control_key = 'delivery'")
      .get() as { value_json: string } | undefined;
    if (!row) return { emergencyStop: false };
    const parsed = JSON.parse(row.value_json) as { emergencyStop?: unknown };
    return { emergencyStop: parsed.emergencyStop === true };
  }

  setEmergencyStop(enabled: boolean, actorUserId: string, occurredAt: string): void {
    this.transaction(() => {
      this.database
        .prepare(`
          INSERT INTO platform_controls(control_key, value_json, updated_by, updated_at)
          VALUES ('delivery', ?, ?, ?)
          ON CONFLICT(control_key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at
        `)
        .run(JSON.stringify({ emergencyStop: enabled }), actorUserId, occurredAt);
      this.insertAudit(occurredAt, actorUserId, "delivery.emergency_stop_changed", "platform", "local", {
        enabled,
      });
    });
  }

  listAuditRecords(limit?: number): AuditRecord[] {
    const statement = limit === undefined
      ? this.database.prepare(`
          SELECT id, occurred_at, actor_user_id, action, object_type, object_id, metadata_json
          FROM audit_log ORDER BY id
        `)
      : this.database.prepare(`
          SELECT id, occurred_at, actor_user_id, action, object_type, object_id, metadata_json
          FROM audit_log ORDER BY id LIMIT ?
        `);
    const rows = (limit === undefined
      ? statement.all()
      : statement.all(Math.max(1, Math.min(50_000, Math.trunc(limit))))) as unknown as Array<{
        id: number;
        occurred_at: string;
        actor_user_id: string | null;
        action: string;
        object_type: string;
        object_id: string | null;
        metadata_json: string;
      }>;
    return rows.map((row) => ({
      id: Number(row.id),
      occurredAt: row.occurred_at,
      actorUserId: row.actor_user_id,
      action: row.action,
      objectType: row.object_type,
      objectId: row.object_id,
      metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    }));
  }
}
