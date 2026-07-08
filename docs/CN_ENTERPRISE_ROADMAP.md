# 企業繁中資安意識平台現代化路線圖

本路線圖以目前 Gophish 程式碼為基準，規劃從「文件與治理原則」到「企業級安全意識平台」的分階段改造。所有階段都必須維持授權訓練、禁止真實憑證竊取、禁止真實密碼保存與可稽核治理。

## Phase 0：治理基準與架構盤點

目標：建立共同語言、工程規則與安全邊界。

範圍：

- 新增 `AGENTS.md`，定義協作規則、安全邊界、工程標準與 Definition of Done。
- 新增繁中架構盤點，對應 `gophish.go`、`controllers/`、`models/`、`worker/`、`mailer/`、`middleware/`、`db/` 等實際模組。
- 新增企業化 roadmap 與術語表。
- 不改變 runtime behavior。

完成條件：

- 文件清楚說明授權訓練與資料保護原則。
- 指出高風險現況，例如 `models/page.go` 的 capture flags 與 `models/result.go` 的 submitted event details。
- 明確列出下一批 PR 的優先順序。

## Phase 1：安全落地頁與無真密碼提交

目標：把「不收真密碼」從政策變成產品預設與程式限制。

建議 PR：

- Rename/soft-deprecate user-facing credential capture language in UI copy.
- 在 landing page 建立 safe-submit 模式：只記錄互動事件，不保存 password、token、OTP、secret answer 等欄位值。
- 在 `models/page.go`、`controllers/phish.go`、`models/result.go` 增加敏感欄位過濾與測試。
- 在 `templates/landing_pages.html`、`static/js/src/app/landing_pages.js` 將 UI 語意改成訓練訊號，而不是憑證收集。
- 加入安全落地頁範本與內容審核 checklist。

完成條件：

- POST 表單事件可計數，但敏感欄位不進入 event details。
- 測試覆蓋 password、otp、token、secret、authorization 等欄位名稱。
- 報表使用「提交訓練表單」或「完成互動」等繁中安全術語。

## Phase 2：RBAC 擴充與組織範圍

目標：支援企業中常見的職責分離與最小權限。

建議 PR：

- 在 `models/rbac.go` 與 migrations 新增角色與權限，例如 campaign_creator、campaign_approver、content_reviewer、delivery_admin、report_viewer、auditor。
- 將 `middleware.RequirePermission` 的使用點擴展到活動啟動、寄信設定、報表匯出、webhook 管理。
- 新增組織/部門/租戶 scope，限制 users、groups、campaigns、reports 的可見範圍。
- 更新 `controllers/api/user.go` 與 `templates/users.html` 支援角色管理。

完成條件：

- 非授權角色不能建立、啟動、核准、停止或匯出活動。
- 系統層設定仍只限管理角色。
- 測試覆蓋允許與拒絕路徑。

## Phase 3：活動核准工作流

目標：任何投遞前都必須經過可稽核核准。

建議 PR：

- 新增 campaign approval 狀態，例如 draft、pending_review、approved、scheduled、in_progress、paused、completed、rejected。
- 在 `models.Campaign` 與 migrations 增加 approval metadata。
- 在 `controllers/api/campaign.go` 阻擋未核准活動進入 `worker.LaunchCampaign`。
- 加入內容審核、受眾範圍審核、寄件設定審核與風險等級。
- UI 增加審核佇列與核准紀錄。

完成條件：

- 未核准活動不能寄送。
- 核准者不能核准自己建立的高風險活動。
- 所有核准、退回、修改、啟動、停止都有 audit log。

## Phase 4：Audit Logs 與報表治理

目標：建立不可否認、可查詢、可匯出的企業稽核紀錄。

建議 PR：

- 新增獨立 audit log model 與 migrations，不混用 `models.Event`。
- 記錄 actor、action、resource、before/after metadata、request id、IP、user agent、時間。
- 對使用者、角色、群組、樣板、落地頁、寄信設定、活動、webhook、報表匯出建立 audit hooks。
- 建立報表治理：預設 aggregate、部門 scope、匯出理由、匯出遮罩。

完成條件：

- 管理操作與投遞操作都有稽核紀錄。
- 報表匯出會被記錄並受權限控管。
- 個人層級資料只有具備明確權限與目的的角色可見。

## Phase 5：Mail Delivery Governance

目標：讓寄送能力可控、可停、可審核、可觀測。

建議 PR：

- 在 `models/smtp.go` 加入 sending profile governance metadata。
- 對寄件網域、SMTP host、envelope sender、自訂 headers 建立 allowlist 與驗證。
- 在 `worker/worker.go` 與 `mailer/mailer.go` 加入配額、rate limit、全域 kill switch、活動 pause/resume。
- 加入 preflight checks：SPF/DKIM/DMARC、退信信箱、contact header、unsubscribe/教育說明連結策略。
- 對 SMTP 密碼與 IMAP 密碼導入 secret manager 或加密儲存。

完成條件：

- 未通過 delivery policy 的活動不能排程。
- 異常投遞可立即停止。
- 所有寄送錯誤與 backoff 狀態可觀測。

## Phase 6：資料保護與隱私

目標：落實個資最小化、保留期限、加密與刪除。

建議 PR：

- 定義資料分類：帳號資料、收件人資料、活動事件、IP/geolocation、郵件內容、整合 payload。
- 對 `models.Result`、`models.Event`、`models.Group`、`models.Target` 增加保留與刪除策略。
- 對 exports 增加 masking 與 purpose logging。
- 對 API responses 檢查敏感欄位暴露。
- 支援資料主體請求流程需要的查詢與刪除。

完成條件：

- 預設報表不暴露不必要 PII。
- 到期資料可安全刪除或匿名化。
- 敏感 secrets 不以明文形式長期保存。

## Phase 7：Training Content 與繁中在地化

目標：把工具轉為可長期營運的教育內容平台。

建議 PR：

- 建立繁中內容分類：釣魚辨識、密碼安全、MFA、商務郵件詐騙、個資保護、通報流程。
- 建立樣板版本、審核狀態、風險等級、適用部門與學習目標。
- 安全落地頁提供即時教學，不羞辱受訓者。
- 加入 LMS 整合欄位與完成紀錄。
- UI 全面繁中化，術語遵循 `docs/CN_TERMINOLOGY.md`。

完成條件：

- 每個訓練活動都有學習目標、受眾、核准紀錄與回饋內容。
- 管理者可以用繁中建立、審核、投遞與報告。

## Phase 8：Integrations 與企業部署

目標：接上企業 IAM、HRIS、SIEM、LMS、郵件與工單生態。

建議 PR：

- SSO/SAML/OIDC 與 SCIM provisioning。
- HRIS/目錄同步，用於部門、主管、受訓對象與離職停用。
- SIEM export，包含 audit logs、delivery events、approval events。
- LMS 完課同步。
- Ticketing integration，用於例外核准、事故追蹤與改善事項。
- Webhook governance，補齊 allowlist、重試、dead letter、欄位遮罩。

完成條件：

- 身份與組織資料由企業來源管理。
- 稽核與安全事件可進入 SIEM。
- 整合失敗時不會繞過核准與投遞治理。

## Phase 9：部署硬化與營運成熟度

目標：支援企業長期穩定營運。

建議 PR：

- 容器化硬化：非 root、唯讀檔案系統、health checks、SBOM、映像簽章。
- 設定檢查：管理端不可公開、TLS 必開、secret 不可留空、DB 備份設定。
- Observability：metrics、structured logs、traces、告警。
- 災難復原：備份、還原演練、migration rollback 計畫。
- CI：lint、unit tests、security scans、migration tests、docs checks。

完成條件：

- 可用標準 IaC/部署文件重建環境。
- 有明確 SLO、備份與事件應變流程。
- 每次 PR 都有自動化檢查。

## 建議下一個 PR

下一個 PR 建議做 Phase 1 的第一步：安全落地頁與敏感欄位過濾。優先處理 `models/page.go`、`controllers/phish.go`、`models/result.go` 與對應測試，確保平台即使保留表單互動量測，也不會保存真實密碼或秘密欄位。
