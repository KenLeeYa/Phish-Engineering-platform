# 功能驗收矩陣

## Local Pilot 軟體範圍

| 區域 | 已完成能力 | 自動驗證 |
|---|---|---|
| 身分 | 一次性 bootstrap、scrypt、強制換密碼、登入節流、session／CSRF、停用／改角／撤銷、最後管理員保護 | server + security-hardening integration |
| 權限 | 四種角色、讀寫 API 權限、角色化 UI、敏感設定最小揭露 | RBAC positive/negative integration |
| 名單 | 群組、CSV／XLSX、內部網域、test mailbox、錯誤／重複摘要 | audience + phase2 + XLSX security tests |
| 範本 | 手動／視覺編輯、EML、版本、離線清理、sandbox、被動附件、maker-checker | sanitizer + phase2 + full-pilot |
| 活動 | 精確 tracking Origin、不可變名單快照、approval digest、雙人覆核、排程、時窗、節流 | full-pilot mutable-roster + exact-origin tests |
| 寄送 | pickup、SMTP 強制 TLS、verify、重試、scope revalidation、suppression、pause／cancel、emergency stop | pickup full-pilot；實際 SMTP 為客戶 Gate |
| 追蹤 | 256-bit token、plaintext 最小生命週期、expiry／revoke、開信、點擊、訓練、受控附件、scanner 分類、去重 | full-pilot token and replay checks |
| 證據 | 附件開啟／退信稽核匯入、來源 SHA-256／reference／event ID、maker 排除 | full-pilot provenance and replay checks |
| 報表 | 原生活動、vendor rawdata、Excel／Word／JSON、分母、delivered 語意、artifact list／hash／size | full-pilot + vendor artifact QA |
| 不受信任 XLSX | ZIP preflight、加密／路徑／VBA／展開比例／大小／列欄上限、formula-injection-safe output | spreadsheet-security tests |
| 維運 | DB check、backup、restore guard、完整 audit、外部 anchor 驗證、完整 retention、Windows Service | operations integration + script syntax |

## Local Pilot 交付判定

軟體功能可判定為 `Local Pilot feature-complete`，代表在本機 pickup 與測試資料範圍內，建立、覆核、寄送、追蹤、附件開啟、證據匯入、報表與維運形成閉環。這不等同客戶 Production Ready，也不代表實際 SMTP relay 已驗證。

## 客戶環境 Gate

下列項目不能由開發環境代替，完成前只可停在 pickup／allowlist 測試信箱：

- 客戶核准的 VM、服務帳號、管理網段、EDR、DNS、TLS、反向代理與防火牆。
- 核准的報表 runtime 封裝與 SHA-256 manifest。
- 真實 SMTP relay 的憑證鏈、來源限制、測試信箱、退信／DSN 來源與節流上限。
- 具名活動 owner、獨立 reviewer、證據匯入者、報表保管者及 emergency-stop 責任人。
- 備份位置、離線副本、實際還原演練、RPO／RTO 與 audit final-hash 外部錨點。
- 客戶 Microsoft Office 版本的 Excel／Word 開啟、列印及個資權限驗收。
- 個資保存期限、員工告知／法務依據、報告查閱、事件分類與刪除流程。

任何 Gate 失敗都不可用廣泛 allowlist、忽略 TLS、共用帳號、關閉 maker-checker 或擴大追蹤網域來通過。

## SaaS 現代化階段

| 階段 | 狀態 | 交付與 Gate |
|---|---|---|
| S0 Tenant-cell foundation | 已建置 | Registry schema、maker-checker、網域碰撞、隔離 data root、manifest digest、secret reference、runtime quota、Docker 與 CI |
| S1 Identity 與 Control Plane | 待建置 | OIDC + PKCE、MFA／group mapping、tenant revision API、reconciler、暫停／撤銷、雙人 promotion |
| S2 Delivery governance | 待建置 | 雲端 provider adapter、webhook signature、bounce／complaint、idempotency、provider quota、正式 sending access E2E |
| S3 Managed data plane | 待量測後建置 | 每 tenant PostgreSQL／queue／object storage、KMS、PITR、容量與故障注入；不得共享無隔離證據的 schema |
| S4 Observability 與法遵 | 待外部核准 | SIEM／WORM、SLO／on-call、DPIA／DPA、subprocessor、資料區域、刪除與事件通報 |
| S5 Production readiness | 待真實環境驗證 | Staging、跨租戶測試、滲透測試、restore drill、key rotation、供應商退場、Production promotion receipt |

S0 通過代表架構與自動化基礎可重現，不代表 S1 到 S5 已完成。申請項目與先後次序見 `docs/SAAS_APPLICATION_REQUIREMENTS.md`。
