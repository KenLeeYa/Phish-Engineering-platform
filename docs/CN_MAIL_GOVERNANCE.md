# 郵件配送治理基礎

本階段加入企業治理控制，但不加入任何 stealth、spam bypass、reputation bypass、閘道規避或未授權寄送能力。

## Suppression List

`models/mail_governance.go` 新增 `SuppressedRecipient`，由 migration 建立：

- `db/db_sqlite3/migrations/20260708040000_mail_governance.sql`
- `db/db_mysql/migrations/20260708040000_mail_governance.sql`

`models/maillog.go` 的 `GetQueuedMailLogs` 會呼叫 `FilterSendableMailLogs`。若受測者地址在 suppression list 中，該筆 `MailLog` 不會回到待寄送佇列，且 PR-005 的 `RecipientDeliveryStatus` 會更新為 `suppressed`。

`worker/worker.go` 的 immediate launch 路徑也會套用相同的 `FilterSendableMailLogs`，避免繞過 suppression 檢查。

## Emergency Stop

`system_settings` 新增 `mail_emergency_stop`。當設定值為 `true`、`1` 或 `enabled` 時，`FilterSendableMailLogs` 會回傳空集合，停止進一步取出待寄送信件。

## Sending Profile 審核

`models/smtp.go` 新增：

- `approved_for_use`
- `reviewer_id`
- `reviewed_at`
- `review_notes`

`models/campaign.go` 的 `LaunchApprovedCampaign` 會拒絕使用未核准的 sending profile，錯誤為 `ErrSendingProfileApprovalRequired`。

## SMTP Secret 保護

`controllers/api/smtp.go` 在回傳 SMTP profile 前會呼叫：

- `models.SanitizeSMTPForResponse`
- `models.SanitizeSMTPsForResponse`

若 `password` 有值，API 回應只會顯示 `********`，不回傳真實 SMTP 密碼。

目前尚未導入密碼欄位加密或外部 secret provider；後續 PR 應加入 secret provider 抽象與 migration 策略。

## 未實作但保留的後續項目

- 每分鐘/每小時 throttling
- 寄送時段與 jitter
- DNS SPF/DMARC/MX/DKIM advisory checker
- test send rate limit 與內部網域 allowlist
- delivery health dashboard UI
