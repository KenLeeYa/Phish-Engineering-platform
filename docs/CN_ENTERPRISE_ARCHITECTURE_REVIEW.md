# 企業繁中資安意識平台架構盤點

本文件說明目前上游 Gophish 程式碼在本專案中的實際架構，作為後續企業化、繁中化與安全治理改造的基準。此 PR 僅新增文件，不改變執行時行為。

## 範圍與安全定位

本平台只能用於已授權的資安意識訓練、演練與教育成效量測。後續所有設計都必須避免真實憑證竊取、真實密碼保存、未授權投遞、不可追蹤的活動，以及會造成羞辱或不當監控的報表。

目前上游語境仍大量使用 phishing、capture credentials 等名稱。企業繁中版本應逐步把產品語意轉為「模擬釣魚訓練」、「安全落地頁」、「互動事件」、「教育回饋」，並在資料模型層建立不可收集真密碼的硬限制。

## 啟動與服務邊界

主要入口在 `gophish.go`。啟動流程包含：

- 讀取 `VERSION` 與 `config.json`。
- 透過 `config.LoadConfig` 載入管理端、訓練端、資料庫與 logging 設定。
- 呼叫 `dialer.SetAllowedHosts` 與 `webhook.SetTransport` 控制部分對外連線。
- 呼叫 `models.Setup` 建立資料庫連線、執行 migrations、建立初始 admin。
- 呼叫 `models.UnlockAllMailLogs` 釋放上次關閉時仍在 processing 狀態的郵件佇列。
- 建立 `controllers.NewAdminServer` 與 `controllers.NewPhishingServer`。
- 依 `--mode` 啟動 admin、phish 或 all 模式。

`config.json` 預設將管理端綁在 `127.0.0.1:3333` 且啟用 TLS，訓練端綁在 `0.0.0.0:80` 且未啟用 TLS。企業部署時應把這些設定納入部署硬化與環境設定檢查。

## 管理端架構

管理端路由集中在 `controllers/route.go`。主要頁面包含 dashboard、campaigns、templates、groups、landing_pages、sending_profiles、settings、users、webhooks。管理頁面使用 `templates/*.html` 與 `static/js/src/app/*.js`。

REST API 由 `controllers/api/server.go` 註冊在 `/api/` 底下，並使用：

- `middleware.RequireAPIKey` 驗證 API key。
- `middleware.EnforceViewOnly` 限制非 GET 方法必須有 `modify_objects` 權限。
- `middleware.RequirePermission(models.PermissionModifySystem)` 保護 users 與 webhooks 等系統層 API。

管理端已有 CSRF 保護與安全標頭：

- `controllers/route.go` 使用 `gorilla/csrf`，API 路徑由 `middleware.CSRFExceptions` 排除。
- `middleware.ApplySecurityHeaders` 設定 `Content-Security-Policy: frame-ancestors 'none';` 與 `X-Frame-Options: DENY`。
- `controllers/route.go` 的 `defaultTLSConfig` 設定最低 TLS 1.2。

企業差距：目前角色只有全域 admin/user，尚未支援租戶、部門、活動審批者、內容審查者、報表檢視者、稽核員等細緻角色，也沒有活動核准流程或完整稽核事件表。

## 訓練端架構

訓練端 HTTP server 在 `controllers/phish.go`。它負責：

- `/track` 與 `/{path}/track`：開信追蹤。
- `/report` 與 `/{path}/report`：回報模擬郵件。
- `/{path:.*}`：訓練落地頁呈現與表單提交事件。
- `/robots.txt`：避免搜尋引擎索引訓練素材。
- transparency suffix `+`：回傳透明度資訊。

`setupContext` 會從 `rid` 參數取得 `models.Result`，載入對應 `models.Campaign`，更新 IP/geolocation，並把 payload、browser address、user-agent 放入 `models.EventDetails`。

安全敏感點：

- `controllers/phish.go` 的 `PhishHandler` 在 POST 時呼叫 `Result.HandleFormSubmit`。
- `models/result.go` 的 `HandleFormSubmit` 會將事件記為 `Submitted Data`，並把 `EventDetails.Payload` JSON 化寫入事件 details。
- `models/page.go` 目前存在 `CaptureCredentials` 與 `CapturePasswords`，而 migration `db/db_sqlite3/migrations/20160225173824_0.1.2_capture_credentials.sql` 與 MySQL 對應 migration 也有這兩個欄位。

企業差距：後續必須移除或重新定義真實密碼收集能力。可接受方向是保存「已提交表單」或「輸入了非敏感訓練代碼」等教育訊號，不保存真實密碼、OTP、token 或 secret。

## 資料模型與儲存

資料庫初始化與 migration 在 `models/models.go` 與 `db/db_sqlite3/migrations/`、`db/db_mysql/migrations/`。目前支援 SQLite 與 MySQL。

核心模型：

- `models.User`：username、bcrypt hash、API key、role、強制改密碼、鎖定與最後登入。
- `models.Role` / `models.Permission`：簡單 RBAC，定義於 `models/rbac.go`。
- `models.Group` / `models.Target`：收件人群組與受訓對象資料。
- `models.Template` / `models.Attachment`：郵件內容與附件。
- `models.Page`：落地頁 HTML、redirect URL、capture flags。
- `models.SMTP` / `models.Header`：寄信設定與自訂 headers。
- `models.Campaign` / `models.Result` / `models.Event`：活動、每位受訓者結果、時間線事件。
- `models.MailLog`：排程寄送佇列與重試狀態。
- `models.Webhook`：事件外送設定。

敏感資料包含 recipient PII、SMTP/IMAP 密碼、API key、使用者 hash、事件 payload、IP/geolocation、webhook secret。企業版需要資料分類、保留期限、加密、遮罩、匯出治理與刪除流程。

## 寄信與投遞流程

寄信流程由 `worker/worker.go`、`models/maillog.go`、`mailer/mailer.go` 與 `models/smtp.go` 組成。

- `models.PostCampaign` 建立 campaign、results 與 maillogs。
- `worker.DefaultWorker.Start` 每分鐘處理到期 mail logs。
- `worker.DefaultWorker.LaunchCampaign` 處理立即啟動活動。
- `models.MailLog.Generate` 套用收件人 context、郵件樣板、自訂 headers、附件與透明度 headers。
- `mailer.sendMail` 對 SMTP 暫時錯誤做 backoff，對永久錯誤標記失敗。
- `models.SMTP.GetDialer` 根據 sending profile 建立 SMTP dialer。

企業差距：目前沒有集中式投遞治理，例如發送網域 allowlist、每日/每活動配額、寄件身份核准、退信政策、異常停止、預演審核、郵件內容掃描、DMARC/SPF/DKIM 檢查或審批前禁止寄送。

## RBAC 與身份治理

RBAC 定義在 `models/rbac.go`，migration 在 `db/db_sqlite3/migrations/20190105192341_0.8.0_rbac.sql`。目前角色：

- `admin`：具備 `view_objects`、`modify_objects`、`modify_system`。
- `user`：具備 `view_objects`、`modify_objects`。

執行點：

- `middleware.EnforceViewOnly` 保護 API 的修改方法。
- `middleware.RequirePermission` 保護系統層功能。
- `controllers/route.go` 用 `RequirePermission(models.PermissionModifySystem)` 保護 users、webhooks、impersonate。
- `controllers/api/user.go` 處理 user 建立、修改與角色調整。

企業差距：需要增加活動建立者、核准者、內容審查者、寄送管理者、唯讀主管、稽核員等角色，也需要按組織、部門、活動範圍限制資料存取。

## 稽核、Webhook 與整合

目前 campaign event 由 `models.AddEvent` 建立，並在同一處呼叫 `webhook.SendAll`。Webhook 定義在 `models/webhook.go`，發送實作在 `webhook/webhook.go`，API 在 `controllers/api/webhook.go`。

現況優點：

- Webhook payload 具備 HMAC signature header `X-Gophish-Signature`。
- `gophish.go` 設定 webhook HTTP transport，可搭配 `dialer` 控制內部連線。

企業差距：

- campaign event 不等於完整 audit log；缺少「誰在何時建立/修改/核准/啟動/停止/匯出」的不可否認紀錄。
- Webhook 需要目的地 allowlist、敏感欄位遮罩、重試與死信策略、簽章輪替、整合健康狀態。
- SIEM、IAM、HRIS、LMS、郵件閘道與工單系統整合尚未抽象化。

## 前端與內容管理

主要 UI template 在 `templates/`，前端 source 在 `static/js/src/app/`，dist 在 `static/js/dist/app/`。

相關檔案：

- `templates/landing_pages.html` 與 `static/js/src/app/landing_pages.js` 控制落地頁編輯與 capture flags。
- `templates/campaigns.html`、`templates/campaign_results.html`、`static/js/src/app/campaigns.js`、`static/js/src/app/campaign_results.js` 控制活動與報表。
- `templates/sending_profiles.html` 與 `static/js/src/app/sending_profiles.js` 控制寄信設定。
- `templates/users.html` 與 `static/js/src/app/users.js` 控制使用者與角色。

企業差距：需要繁中 UI、受訓者友善的安全落地頁、內容審核狀態、訓練素材版本管理、主管與稽核報表視圖、個資最小化匯出。

## 部署與硬化

現有部署資產包含 `Dockerfile`、`docker/run.sh`、`ansible-playbook/` 與 `config.json`。程式內已有部分 TLS、CSRF、CSP、API key 與 password policy 基礎。

企業硬化方向：

- 反向代理與 TLS 終止標準化。
- secrets 改由環境或 secret manager 注入。
- 管理端禁止公開暴露。
- 訓練端網域與憑證由核准流程管理。
- DB 連線 TLS、備份、保留期限與還原演練。
- 結構化 logs、metrics、tracing 與 SIEM 匯出。
- 容器映像掃描、SBOM、簽章與最小權限執行。

## 結論

目前程式碼提供完整的模擬活動、寄信、追蹤、報表與基本 RBAC 能力，但企業化所需的核准、稽核、資料保護、投遞治理、安全落地頁與繁中內容治理仍需分階段補齊。下一個 PR 應優先處理安全邊界最敏感的落地頁與資料提交模型，先把「不保存真實密碼」變成產品與程式層面的預設規則。
