# 企業整合與 Webhook 治理基礎

本階段建立整合 registry、外部事件 envelope 與 webhook delivery log schema。所有整合只支援授權的防禦性教育流程，不對第三方送出 raw submitted values、SMTP secrets、API secrets、cookie、session 或驗證碼。

## Integration Registry

`models/integration.go` 新增 `EnterpriseIntegration`：

- `type`: `webhook`, `siem`, `lms`, `idp`, `hr_directory`, `chatops`
- `status`: `disabled`, `enabled`, `error`
- `config_json`: 僅允許非機密設定
- `secret_reference`: 指向外部 secret provider 或後續加密儲存的參照
- `created_by`, `updated_by`, `created_at`, `updated_at`

Migration：

- `db/db_sqlite3/migrations/20260708070000_integrations.sql`
- `db/db_mysql/migrations/20260708070000_integrations.sql`

`SanitizeIntegrationForResponse` 不會回傳 `config_json`，避免 UI/API 洩漏機密設定。

## Signed Webhooks

既有 `webhook/webhook.go` 已使用 `X-Gophish-Signature` 與 HMAC-SHA256 簽章。本階段不改 transport 行為，只補上 delivery log schema 與 normalize payload helper，後續可把 retry/audit 狀態接入 sender。

## Normalized Event Payload

`IntegrationEventPayload` 包含：

- `schema_version`
- `event_id`
- `event_type`
- `timestamp`
- `campaign_id`
- `recipient_result_id`
- `data`

`SanitizeIntegrationData` 會移除 password、otp、token、credential、cookie、session、信用卡、身分證等敏感欄位。

建議事件名稱：

- `campaign.created`
- `campaign.approved`
- `campaign.launched`
- `campaign.completed`
- `recipient.email_sent`
- `recipient.email_bounced`
- `recipient.opened`
- `recipient.clicked`
- `recipient.submitted_simulated_form`
- `recipient.reported`
- `training.assigned`
- `training.completed`
- `report.exported`
- `audit.sensitive_action`

## API

`controllers/api/integrations.go` 新增：

- `GET /api/integrations/`
- `POST /api/integrations/`

需要 `manage_webhooks` 權限；未授權時回傳 zh-TW 訊息。

## 後續

- webhook retry worker
- webhook delivery log 寫入與重送
- secret rotation UI
- IdP / HR directory adapter interface
- LMS completion callback
- Teams/Slack approval notification，且不得在廣播頻道揭露受測者細節
