-- +goose Up
-- SQL in section 'Up' is executed when this migration is applied

ALTER TABLE "smtp" ADD COLUMN "approved_for_use" BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE "smtp" ADD COLUMN "reviewer_id" INTEGER;
ALTER TABLE "smtp" ADD COLUMN "reviewed_at" DATETIME;
ALTER TABLE "smtp" ADD COLUMN "review_notes" TEXT;

CREATE TABLE IF NOT EXISTS "suppressed_recipients" (
    "id"         INTEGER PRIMARY KEY AUTOINCREMENT,
    "user_id"    INTEGER NOT NULL,
    "email"      VARCHAR(255) NOT NULL,
    "reason"     VARCHAR(255),
    "created_by" INTEGER,
    "created_at" DATETIME
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_suppressed_recipients_user_email"
ON "suppressed_recipients" ("user_id", "email");

INSERT INTO "system_settings" ("key", "value")
SELECT 'mail_emergency_stop', 'false'
WHERE NOT EXISTS (
    SELECT 1 FROM "system_settings"
    WHERE "key" = 'mail_emergency_stop'
);

-- +goose Down
-- SQL section 'Down' is executed when this migration is rolled back

DELETE FROM "system_settings"
WHERE "key" = 'mail_emergency_stop';

DROP TABLE "suppressed_recipients";
