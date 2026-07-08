-- +goose Up
-- SQL in section 'Up' is executed when this migration is applied

CREATE TABLE IF NOT EXISTS "system_settings" (
    "id"    INTEGER PRIMARY KEY AUTOINCREMENT,
    "key"   VARCHAR(255) NOT NULL UNIQUE,
    "value" TEXT
);

INSERT INTO "system_settings" ("key", "value")
SELECT 'landing_page_submission_mode', 'metrics_only'
WHERE NOT EXISTS (
    SELECT 1 FROM "system_settings"
    WHERE "key" = 'landing_page_submission_mode'
);

-- +goose Down
-- SQL section 'Down' is executed when this migration is rolled back

DELETE FROM "system_settings"
WHERE "key" = 'landing_page_submission_mode';
