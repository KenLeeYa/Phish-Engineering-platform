-- +goose Up
-- SQL in section 'Up' is executed when this migration is applied

ALTER TABLE "campaigns" ADD COLUMN "authorization_scope" VARCHAR(255) DEFAULT 'authorized_internal_training';
ALTER TABLE "campaigns" ADD COLUMN "retention_policy" VARCHAR(255) DEFAULT 'default_retention_policy';
ALTER TABLE "campaigns" ADD COLUMN "approver_id" INTEGER DEFAULT 0;
ALTER TABLE "campaigns" ADD COLUMN "approved_at" datetime;
ALTER TABLE "campaigns" ADD COLUMN "approval_notes" TEXT;
ALTER TABLE "campaigns" ADD COLUMN "rejection_reason" TEXT;

UPDATE "campaigns"
SET "authorization_scope" = 'authorized_internal_training'
WHERE "authorization_scope" IS NULL OR "authorization_scope" = '';

UPDATE "campaigns"
SET "retention_policy" = 'default_retention_policy'
WHERE "retention_policy" IS NULL OR "retention_policy" = '';

CREATE TABLE "audit_logs" (
    "id"                  INTEGER PRIMARY KEY AUTOINCREMENT,
    "timestamp"           datetime NOT NULL,
    "actor_user_id"       INTEGER,
    "actor_role"          VARCHAR(255),
    "action"              VARCHAR(255) NOT NULL,
    "entity_type"         VARCHAR(255) NOT NULL,
    "entity_id"           INTEGER,
    "before_summary"      TEXT,
    "after_summary"       TEXT,
    "ip_address"          VARCHAR(255),
    "user_agent"          TEXT,
    "request_id"          VARCHAR(255),
    "hash_chain_previous" TEXT,
    "hash_chain_current"  TEXT
);

-- +goose Down
-- SQL section 'Down' is executed when this migration is rolled back

DROP TABLE "audit_logs";
