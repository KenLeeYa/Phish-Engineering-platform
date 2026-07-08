# 中文訓練內容與補救學習基礎

本階段新增防禦性教育訓練層，讓演練結果可以連到安全、非羞辱式的微課程與完成追蹤。內容只適用於授權的內部教育訓練，不提供未授權 phishing、憑證竊取、MFA 繞過、session capture、stealth 或規避技巧。

## 資料模型

`models/training.go` 新增：

- `TrainingModule`
- `TrainingLesson`
- `Quiz`
- `QuizQuestion`
- `QuizAnswer`
- `TrainingAssignment`
- `TrainingCompletion`
- `TrainingFeedback`

Migration：

- `db/db_sqlite3/migrations/20260708050000_training_content.sql`
- `db/db_mysql/migrations/20260708050000_training_content.sql`

## 初始 zh-TW draft 模組

Migration 會建立四個短篇原創草稿模組：

- 辨識可疑郵件的五個線索
- 安全處理登入與表單
- 正確回報可疑郵件
- 商務郵件詐騙與請款驗證

這些內容聚焦防禦行為：查核寄件者、避免輸入真實密碼、使用公司核准回報管道、以第二通道確認請款或帳號變更。

## 補救訓練規則基礎

`TrainingCategoryForResultStatus` 提供最小映射：

- `Clicked Link` -> `phishing_recognition`
- `Submitted Data` -> `safe_form_handling`
- `Email Reported` -> `positive_reinforcement`
- 其他狀態 -> `advanced_awareness`

`AssignTrainingForResult` 可依受測者 `Result` 建立 `TrainingAssignment`，保留 campaign、result、`rid`、受測者 email、模組與指派原因。

## 完成與測驗

`CompleteTrainingAssignment` 會建立 `TrainingCompletion`，記錄分數、是否通過、嘗試次數、完成時間與完成來源。`EvaluateQuizPassing` 使用透明 passing score 判斷，不做心理或 HR 評分。

## API

`controllers/api/training.go` 新增：

- `GET /api/training/modules/`
- `POST /api/training/modules/`

建立訓練模組需要 `manage_training_content` 權限；未授權時回傳 zh-TW 訊息。

## 後續

- 建立訓練模組編輯 UI
- 審核/發布 workflow
- campaign event 自動觸發補救訓練
- training completion 報表
- 與 LMS / HRIS 整合
