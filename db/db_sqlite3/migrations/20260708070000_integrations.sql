-- +goose Up
-- SQL in section 'Up' is executed when this migration is applied

CREATE TABLE IF NOT EXISTS "enterprise_integrations" (
    "id"               INTEGER PRIMARY KEY AUTOINCREMENT,
    "type"             VARCHAR(64) NOT NULL,
    "name"             VARCHAR(255) NOT NULL,
    "status"           VARCHAR(64) NOT NULL,
    "config_json"      TEXT,
    "secret_reference" VARCHAR(255),
    "created_by"       INTEGER,
    "updated_by"       INTEGER,
    "created_at"       DATETIME,
    "updated_at"       DATETIME
);

CREATE TABLE IF NOT EXISTS "webhook_delivery_logs" (
    "id"             INTEGER PRIMARY KEY AUTOINCREMENT,
    "integration_id" INTEGER,
    "event_type"     VARCHAR(128) NOT NULL,
    "event_id"       VARCHAR(255) NOT NULL,
    "status"         VARCHAR(64) NOT NULL,
    "attempt_count"  INTEGER NOT NULL DEFAULT 0,
    "last_error"     TEXT,
    "created_at"     DATETIME,
    "updated_at"     DATETIME
);

CREATE INDEX IF NOT EXISTS "idx_enterprise_integrations_type_status"
ON "enterprise_integrations" ("type", "status");

CREATE INDEX IF NOT EXISTS "idx_webhook_delivery_logs_event"
ON "webhook_delivery_logs" ("event_type", "event_id");

-- +goose Down
-- SQL section 'Down' is executed when this migration is rolled back

DROP TABLE "webhook_delivery_logs";
DROP TABLE "enterprise_integrations";
