# 演練活動審核與稽核紀錄

本階段新增企業版演練活動的最小審核流程與基本稽核紀錄，目的在於防止未經授權的正式寄送。

## 安全邊界

- 僅允許授權的內部安全意識訓練與防禦性演練。
- 本階段未修改 landing page submission 行為。
- 本階段未修改郵件內容產生、SMTP 傳送或追蹤邏輯。
- 建立演練活動後預設為 `Draft`，不會自動啟動寄送。
- 演練活動必須審核通過後，才可進入既有寄送 lifecycle。

## 狀態

- `Draft`：草稿。
- `Pending Approval`：已送審。
- `Approved`：已審核通過。
- `Rejected`：已退回。
- `Queued`：已核准且排程等待啟動。
- `In progress`：已核准且進行中。
- `Completed`：已完成。
- `Paused` / `Cancelled`：保留給後續流程使用。

## 權限

- 建立與送審演練草稿：`create_campaign_draft`
- 審核與退回演練活動：`approve_campaign`
- 啟動演練活動：`launch_campaign`
- 完成演練活動：`pause_complete_campaign`

## API 行為

- `POST /api/campaigns/`：建立 `Draft`。
- `POST /api/campaigns/{id}/submit`：送審。
- `POST /api/campaigns/{id}/approve`：審核通過，可帶 `notes`。
- `POST /api/campaigns/{id}/reject`：退回，必須提供 `reason`。
- `POST /api/campaigns/{id}/launch`：僅允許已核准活動啟動。
- `GET /api/campaigns/{id}/complete`：完成活動，需具備完成/暫停權限。

## 稽核紀錄

新增 `audit_logs` 表，記錄敏感操作：

- 建立演練活動
- 刪除演練活動
- 送審
- 審核通過
- 退回
- 啟動
- 完成

欄位包含 actor、角色、action、entity、before/after summary、IP、User-Agent、request id，以及預留的 hash-chain 欄位。

## 已知限制

- Hash chaining 欄位已預留，但鏈式雜湊計算尚未實作。
- 前端尚未加入完整審核操作按鈕與對話框；本階段先完成 API-first 的後端安全流程。
- Landing page 安全提交與敏感欄位清除屬於下一階段。
- Sending profile approval 與更細緻的 mail governance 尚未實作。
