# 報表治理與訓練風險指標

本階段建立 aggregate-first 報表基礎，避免在管理報表中不必要地暴露受測者 PII。這裡的分數一律稱為「訓練風險指標」，不是心理分數，也不是 HR 績效分數。

## 聚合摘要

`models/reporting.go` 新增 `EnterpriseReportSummary`，彙總：

- 收件總數
- sent / delivered / opened / clicked
- submitted simulated form
- reported suspicious email
- bounced / deferred / failed / suppressed
- training assigned / completed
- repeat-risk count
- training-risk indicator 與 level

資料來源包含：

- `events`
- `results`
- `recipient_delivery_statuses`
- `training_assignments`
- `training_completions`

## 透明風險權重

`DefaultTrainingRiskWeights` 預設：

- clicked link: `+30`
- submitted simulated form: `+50`
- did not complete assigned training: `+20`
- repeated risky behavior: `+20`
- reported suspicious email: `-30`
- completed training: `-20`

`CalculateTrainingRiskIndicator` 接受自訂 `TrainingRiskWeights`，後續可接到管理 UI 或設定檔。

## 隱私門檻

Migration 新增 `report_privacy_threshold` system setting，預設 `5`。當受測者總數低於門檻時，summary 會標示：

- `privacy_protected: true`
- `privacy_message: 資料量不足，為保護隱私不顯示細部資料`

## API

`controllers/api/reporting.go` 新增：

- `GET /api/campaigns/{id}/enterprise_summary`

需要以下任一權限：

- `export_reports`
- `view_training_completion`
- `view_recipient_pii`

## 後續

- CSV export 與 export audit log
- campaign comparison
- department trend
- Department Manager scoped aggregate view
- repeat-risk 跨活動計算
- dashboard UI
