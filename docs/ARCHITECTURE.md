# 架構與信任邊界

## 部署形態

核心採 TypeScript 模組化單體，支援 `local_single_tenant` 與 `saas_tenant_cell` 兩種模式。兩者在一個執行程序內都只服務一個 tenant；SaaS 由宣告式 registry 與 orchestrator 建立多個隔離 cell，不共享 SQLite、vault、報表或備份。只有容量、高可用與實測 lock 指標達到升級條件後，單一 cell 才改用 managed PostgreSQL／獨立 queue 與 worker。

```text
管理者瀏覽器 ──HTTPS／管理網段──> 管理 hostname ──> Fastify 管理 API
                                                       │
                     ┌─────────────────────────────────┼─────────────────────────┐
                     │                                 │                         │
               Identity / RBAC             Audience / Template        Campaign / Report
                     │                                 │                         │
                     └──────────────────────> SQLite + Audit <───────────────────┘
                                                       │
                                      pickup EML 或 TLS SMTP connector
                                                       │
                                                  客戶郵件系統

員工郵件 ──HTTPS──> 追蹤 hostname ──> 僅 /t/*、/training/*
                                          │
                            有效期 token + 分類事件，不收憑證
```

遠端 Pilot 必須由反向代理分離管理與追蹤 DNS。應用程式本身仍做精確 Host、Origin、CSRF、角色、活動狀態與 token 生命週期檢查；反向代理不是唯一控制。

## 模組責任

- `domain`：設定、RBAC、密碼與 token、範本清理、附件 allowlist、事件分類、報表語意，以及 `saas.ts` 的 tenant manifest／配額契約。
- `application`：帳號生命週期、名單、範本覆核、活動、寄送、安全事件、稽核匯入與報表流程。
- `infrastructure`：SQLite migration、不可變核准快照、AES-256-GCM vault、pickup／SMTP、試算表 runtime、artifact storage。
- `web`：Fastify API、安全標頭、Host 分流、管理 UI、訓練頁及最小公開端點。
- `scripts`：資料庫檢查、備份、還原、完整 retention、audit 驗證、Windows Service，以及 no-secret SaaS deployment plan。

## 身分與授權

首次初始化需同時具備本機服務與 `SEA_BOOTSTRAP_TOKEN`；建立第一位管理員後 `/api/setup` 永久拒絕再次初始化。新帳號與重設密碼均標記 `mustChangePassword`，變更完成會撤銷所有既有 session。

四種角色的核心責任：

| 角色 | 主要能力 |
|---|---|
| `system_admin` | 範圍、帳號、連接器、寄送控制、證據匯入、報表與 audit |
| `campaign_creator` | 名單、範本、活動建立／送審／排程；不能自行核准或匯入正式證據 |
| `reviewer` | 檢視範本與活動、獨立核准／退回；不能讀名單或連接器設定 |
| `report_viewer` | 檢視活動、產生與下載報表；不能改活動或範圍 |

前端只呈現可用功能，但權威判定一律位於 API。停用、改角色、重設密碼與手動撤銷都會刪除該帳號 session；資料層禁止移除最後一位啟用中的系統管理員。

## 覆核與寄送狀態機

```text
Template: draft -> pending_review -> approved
                      |                |
                      +-> rejected -> draft
新版本一律回到 draft，舊 pending review 失效。

Campaign: draft -> pending_review -> approved -> scheduled -> running -> completed
                     |                     |          |
                     +-> rejected -> draft +-> paused +-> cancelled
```

活動送審時把範本版本、連接器、追蹤 Origin、時窗、節流、test-only 狀態與逐一收件人快照計算成 SHA-256 digest，並保存不可變名單。排程前重算 digest；排程與每封寄送前還會重新檢查目前的收件／寄件 allowlist、測試信箱、連接器狀態及部署核准 Origin。名單或設定被撤銷時，未寄送目標 fail closed，token 同時失效。

資料層以條件式 `UPDATE ... WHERE status='queued' AND campaign status...` claim delivery，避免在暫停／取消競態下繼續寄送。Emergency stop 每封寄送前再次讀取。

## 郵件與事件語意

- `sent`／`sentAcceptedCount` 表示 connector 接受，不等於 delivered；實際投遞需 DSN、退信或客戶郵件系統證據。
- 暫時失敗最多三次並採退避；永久失敗、取消、抑制、scope revoke 或到期都清除 plaintext token 並撤銷目標。
- 256-bit token 只在排程至寄送完成前暫存；寄送後 SQLite 僅保留 SHA-256，郵件內 token 在有效期內仍可比對。
- 相同行為類型、來源、actor class 與附件的追蹤事件具去重鍵，避免重複載入無限寫入。
- 開信為低信賴；點擊為中信賴；受控附件與具來源證據的匯入為高信賴。已知 scanner／prefetch 保留但不納入人員率。
- 稽核匯入只接受附件開啟或退信，必須有來源檔 SHA-256、來源參照與唯一事件 ID；活動建立者／送審者不能匯入自己的高信賴證據。

## 報表與不受信任檔案

EML 與 XLSX 都是不受信任輸入。EML 不保存原始傳輸標頭，會移除腳本、表單、外部圖片、外部樣式與 live URL；巨集、執行檔及遠端範本附件隔離。

XLSX 在交給 runtime 前解析 ZIP 中央目錄，拒絕 ZIP64、多磁碟、加密、路徑穿越、VBA、過多項目、異常解壓比例、超大解壓內容與超過 50,000 列／64 欄／750,000 cells 的工作表。報表一次只允許一個 generation job，總 artifact 達 3,000 時需先執行 retention。下載前同時驗證允許根目錄、檔案大小與 SHA-256。

Word 僅含彙總；Excel／JSON 可包含逐人資料，必須受 `view_reports` 與客戶檔案 ACL 保護。未提供完整分母時不計算正式率；未取得 DSN 時不宣稱送達。

## 秘密、稽核與保存期限

SMTP 密碼以 `SEA_MASTER_KEY` 使用 AES-256-GCM 寫入獨立 vault，每筆具獨立 IV 並以 secret reference 作 AAD；SQLite、audit 與 API 不回傳密碼。正式 Pilot 可依客戶規範改接 DPAPI／企業 vault。

Audit export 不截斷，包含總筆數、首尾 ID、完整性宣告與 SHA-256 chain。這只保證匯出檔內一致性；需要抗竄改證據時，客戶應獨立保存 final hash。

Retention 預設 dry-run；apply 會依設定保存天數處理 session、事件、過期 token、已結案活動、artifact、外部報表工作、舊群組成員、孤立 recipient、pickup、服務 log 與 audit，並留下新的 maintenance audit。執行 apply 前應先備份並停止服務。

## SaaS 邊界

`0.7.0` 已建立 SaaS tenant-cell foundation：tenant manifest、maker-checker、跨 tenant 網域碰撞檢查、隔離 data root、manifest digest、secret reference、runtime 配額、容器與 CI。詳細契約見 `docs/SAAS_ARCHITECTURE.md`。

目前仍不是 Production Ready 多租戶服務。OIDC runtime、雲端郵件 adapter、集中 control plane／reconciler、managed database／queue／object storage、WORM audit、on-call、DR 與法遵需分階段完成並取得真實環境證據。任何 cell 都不得用共享資料目錄或只加 `tenant_id` 的方式繞過隔離。
