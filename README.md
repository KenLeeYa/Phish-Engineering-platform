# Enterprise Security Awareness Platform

僅供經授權內部安全意識教育與演練使用的企業平台。本專案採用獨立的 runtime、schema 與程式碼，不收集真實密碼或登入憑證。

目前版本為 `0.7.0 SaaS tenant-cell foundation`。既有 Local Pilot 已形成完整閉環；新增宣告式 tenant registry、maker-checker、隔離資料根目錄、配額、無秘密部署計畫、容器基線與 CI。集中 OIDC、雲端郵件 adapter、真正控制面、managed data services、監控／DR 與法遵核准仍是 Production Gate，不應把 foundation 宣稱為已正式上線。

## 已建置功能

- SaaS 採「宣告式控制面 + tenant-isolated cell」：每個 tenant 獨立 database、vault、報表、pickup 與備份，不以共享 schema 加 `tenant_id` 取代隔離。
- Tenant manifest 具穩定 schema、申請／核准雙人覆核、精確網域、OIDC／delivery secret reference、保存期限與配額；跨 tenant 衝突會被拒絕。
- `saas_tenant_cell` 啟動時驗證 manifest digest、HTTPS／Host／Origin、安全秘密注入與所有資料路徑；任何缺漏都 fail closed。

- 一次性初始化碼、scrypt 密碼、強制初始密碼變更、登入節流、伺服器端 session、CSRF、Host／Origin 防護與帳號停用／session 撤銷。
- `system_admin`、`campaign_creator`、`reviewer`、`report_viewer` 四種角色；讀取與異動 API 都在伺服器端檢查權限。
- CSV／XLSX 名單群組匯入、客戶內部收件網域 allowlist、重複與錯誤列摘要；支援標題欄位及無標題 `A=部門、B=姓名、C=Email、D=部群／廠區` 參考格式，XLSX 先檢查 ZIP、解壓大小、項目數與工作表規模。
- 手動及視覺化範本、版本紀錄、安全 EML 匯入、外部資源清理、sandbox 預覽與被動附件隔離。
- 範本與活動 maker-checker；活動送審時保存不可變收件人快照及 delivery-critical SHA-256 digest，之後名單異動不會偷換已核准對象。
- 本機 pickup 與強制 TLS 的 SMTP adapter、測試信箱驗證、寄送時窗、節流、暫時錯誤重試、suppression、暫停、取消及 emergency stop。
- 開信、點擊、訓練頁、完成提醒、受控附件入口；scanner／prefetch 與人員行為分開。真正 MIME 附件的開啟只接受具來源 digest 與事件 ID 的客戶稽核匯入。
- 原生活動與外部 `rawdata.xlsx` 相容匯入；自動產出 Excel、Word、JSON，保留分母與資料品質警示，下載前重算 SHA-256。
- SQLite 線上備份、還原前完整性檢查、完整 audit 匯出與檔內雜湊鏈驗證、retention dry-run／apply、NSSM Windows Service 安裝腳本。

## 安全邊界

- 不收集或保存員工密碼、OTP、Token、Cookie、Session 或其他登入憑證。
- 不提供巨集、可執行附件、遠端文件範本、防護繞過、scanner 規避或廣泛郵件放行功能。
- 受控附件連結的開啟可精確記錄；實際附檔是否在郵件程式開啟，平台不做推測。
- `sent` 只表示寄送端接受，不等於實際投遞。沒有 DSN／退信證據時，報告明確顯示 delivered 未取得。
- 追蹤 token 具有效期；寄送後資料庫只保留雜湊，取消、抑制、永久失敗、範圍撤銷或到期都會撤銷。
- 管理與公開追蹤 hostname 在遠端 Pilot 必須分離。活動只接受部署時設定的精確 tracking Origin。
- Audit hash chain 證明匯出檔內一致性；如需外部抗竄改保證，必須將 final hash 存入客戶既有 WORM／SIEM／可信時間戳系統。

## 本機啟動

需要 Node.js 24 以上版本。XLSX 匯入與 Excel 產出還需要核准的 `@oai/artifact-tool` runtime：

```powershell
cd 'C:\Users\KY\Documents\Codex projects\Social-Email-Engineering\local-awareness-platform'
$env:SEA_ARTIFACT_TOOL_MODULE = 'D:\ApprovedRuntime\artifact_tool.mjs'
npm ci
npm run verify
.\run-local.ps1
```

`run-local.ps1` 會產生只在該次程序有效的一次性初始化碼並顯示於終端機。現有開發工作區若已有測試 runtime，腳本會明確顯示採用的完整路徑；正式封裝不可依賴相鄰專案。

開啟 `http://127.0.0.1:4280`，輸入終端機顯示的初始化碼建立首位管理員。

## SaaS Tenant 計畫

先以 `.example` 範例驗證 schema：

```powershell
npm run saas:validate
```

經不同人核准正式 registry 後，產生不含秘密值的部署計畫：

```powershell
npm run build
node scripts/plan-saas-tenant.mjs `
  --registry C:\SecureConfig\saas-tenants.json `
  --tenant tenant-customer-001 `
  --data-root D:\SecurityAwareness\Tenants `
  --output .local-data\plans\tenant-customer-001.json
```

需要先申請的公司、DNS、IdP、郵件、KMS、監控、個資與選配計費資料，見 [SaaS 上線前申請資料](docs/SAAS_APPLICATION_REQUIREMENTS.md)。不要把 secret value 寫入 registry 或 Git。

## 建議本機驗收流程

1. 系統管理員設定內部收件網域、核准寄件網域與 allowlist 測試信箱。
2. 建立群組，匯入只含客戶測試信箱的 CSV／XLSX。
3. 建立或匯入 EML 範本，以另一個 reviewer 帳號核准。
4. 建立 pickup 連接器並驗證；測試 EML 位於 `.local-data/pickup`。
5. 建立 `testOnly` 活動、送審、由 reviewer 核准、排程並處理佇列。
6. 從 pickup 郵件測試開信、點擊、訓練確認與受控附件開啟。
7. 以具 `sourceDigest`、`sourceReference`、`sourceEventId` 的資料測試客戶稽核匯入。
8. 由具報表產生權限的帳號產出 Excel／Word／JSON，下載 audit JSON 並執行驗證腳本。

## 報表 runtime

應用程式只尋找下列明確位置：

1. `SEA_ARTIFACT_TOOL_MODULE` 指向的 `artifact_tool.mjs`。
2. 本專案 `node_modules/@oai/artifact-tool/dist/artifact_tool.mjs`。

缺少 runtime 時，XLSX 與 Excel API 會明確回傳 `503`；不會從網路下載，也不會偷偷搜尋其他專案。客戶封裝應一併交付核准 runtime 與 SHA-256 manifest。

## 驗證與維運

```powershell
$env:SEA_ARTIFACT_TOOL_MODULE = 'D:\ApprovedRuntime\artifact_tool.mjs'
npm run verify
npm run verify:ci
npm audit --audit-level=moderate
node scripts/check-database.mjs .local-data/platform.sqlite
node scripts/maintenance.mjs --database .local-data/platform.sqlite --reports .local-data/reports --pickup .local-data/pickup --logs .local-data
```

完整說明：

- [架構與信任邊界](docs/ARCHITECTURE.md)
- [SaaS 架構與隔離模型](docs/SAAS_ARCHITECTURE.md)
- [SaaS 上線前申請資料](docs/SAAS_APPLICATION_REQUIREMENTS.md)
- [SaaS Tenant Cell 維運](docs/SAAS_OPERATIONS.md)
- [功能驗收矩陣](docs/PHASE_ROADMAP.md)
- [客戶一次性設定](docs/CUSTOMER_ONE_TIME_SETUP.md)
- [安全基線](docs/SECURITY_BASELINE.md)
- [維運與成本模型](docs/OPERATIONS_AND_COST.md)
