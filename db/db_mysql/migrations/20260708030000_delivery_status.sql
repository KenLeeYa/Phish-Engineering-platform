-- +goose Up
-- SQL in section 'Up' is executed when this migration is applied

CREATE TABLE IF NOT EXISTS `recipient_delivery_statuses` (
    `id`                    INTEGER PRIMARY KEY AUTO_INCREMENT,
    `campaign_id`           INTEGER NOT NULL,
    `recipient_id`          INTEGER NOT NULL,
    `r_id`                  VARCHAR(255) NOT NULL,
    `user_id`               INTEGER NOT NULL,
    `email`                 VARCHAR(255) NOT NULL,
    `sending_profile_id`    INTEGER,
    `scheduled_at`          DATETIME,
    `attempted_at`          DATETIME,
    `sent_at`               DATETIME,
    `status`                VARCHAR(64) NOT NULL,
    `provider_message_id`   VARCHAR(255),
    `smtp_response_summary` TEXT,
    `retry_count`           INTEGER NOT NULL DEFAULT 0,
    `last_error_summary`    TEXT,
    `created_at`            DATETIME,
    `updated_at`            DATETIME,
    UNIQUE KEY `idx_recipient_delivery_statuses_rid` (`r_id`),
    KEY `idx_recipient_delivery_statuses_campaign_user` (`campaign_id`, `user_id`)
);

-- +goose Down
-- SQL section 'Down' is executed when this migration is rolled back

DROP TABLE `recipient_delivery_statuses`;
