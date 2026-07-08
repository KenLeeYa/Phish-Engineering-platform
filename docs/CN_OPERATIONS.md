# 營運手冊

## 啟動前檢查

- 確認 `landing_page_submission_mode` 為安全模式，預設 `metrics_only`。
- 確認 `mail_emergency_stop` 預設為 `false`，且維運人員知道如何改成 `true`。
- 確認 sending profile 已審核 `approved_for_use`。
- 確認 suppression list 已匯入必要的 do-not-send / bounce 名單。

## 監控

- `/healthz` 應回傳 `status: ok`。
- `/readyz` 應回傳 database `ok`。
- 監控 mail queue、delivery status、audit log、webhook delivery log 與 training completion 聚合指標。

## 變更管理

- 活動必須經 PR-003 approval workflow。
- 高風險設定如 emergency stop、retention、webhook、sending profile 變更應建立 audit log。
- 匯出報表應使用 governed report API，並遵守 RBAC。
