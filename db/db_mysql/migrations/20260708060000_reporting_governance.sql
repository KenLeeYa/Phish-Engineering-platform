-- +goose Up
-- SQL in section 'Up' is executed when this migration is applied

INSERT INTO `system_settings` (`key`, `value`)
SELECT 'report_privacy_threshold', '5'
WHERE NOT EXISTS (
    SELECT 1 FROM `system_settings`
    WHERE `key` = 'report_privacy_threshold'
);

-- +goose Down
-- SQL section 'Down' is executed when this migration is rolled back

DELETE FROM `system_settings`
WHERE `key` = 'report_privacy_threshold';
