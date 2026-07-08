# 郵件配送佇列與受測者狀態基礎

本階段只建立治理所需的可觀測資料層，不新增繞送、規避、投遞最佳化或任何濫用型寄送能力。

## 已加入的狀態模型

`models/delivery_status.go` 新增 `RecipientDeliveryStatus`，用來記錄每位受測者的配送生命週期：

- `queued`
- `scheduled`
- `sending`
- `sent`
- `deferred`
- `bounced`
- `failed`
- `cancelled`
- `suppressed`

資料表由 `db/db_sqlite3/migrations/20260708030000_delivery_status.sql` 與 `db/db_mysql/migrations/20260708030000_delivery_status.sql` 建立。

## 與既有寄送流程的關係

`models/campaign.go` 在 `PostCampaign` 建立 `Result` 與 `MailLog` 時，同步建立一筆 `RecipientDeliveryStatus`。這不會啟動寄送，也不會繞過 PR-003 的活動審批流程。

`models/result.go` 在既有狀態處理函式中更新配送狀態：

- `HandleEmailSent` 更新為 `sent`
- `HandleEmailBackoff` 更新為 `deferred`，並保存摘要化錯誤
- `HandleEmailError` 更新為 `failed`，並保存摘要化錯誤

錯誤欄位不得保存 SMTP 密碼、API token、cookie、session 或其他機密；目前只保存既有錯誤摘要，後續治理 PR 會加入更完整的 secret redaction。

## API 可見性

`controllers/api/server.go` 新增：

- `GET /api/campaigns/{id}/delivery`

`controllers/api/campaign.go` 的 `CampaignDelivery` 只提供查詢，且需要下列任一權限：

- `view_recipient_pii`
- `launch_campaign`
- `export_reports`

這讓管理者可以檢視每位受測者的配送狀態、最後錯誤摘要與 retry 次數，但不提供手動重送或繞過治理的能力。

## 後續

下一階段應加入 suppression list、緊急停止、寄送時段與 throttling 治理，並在配送前強制套用 suppression 檢查。
