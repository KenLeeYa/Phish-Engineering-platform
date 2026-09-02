# 客戶一次性設定清單

Local Pilot 的軟體功能已建置完成；本文件列出只能在客戶環境由授權管理員完成的部署事項。現在不需要把任何真實秘密交給開發端。

## 1. 主機、DNS、網路與 TLS

- 專用 Windows VM／伺服器、固定 IP、服務帳號、管理帳號、EDR、磁碟加密與檔案 ACL。
- 管理 DNS（例：`awareness-admin.customer.example`）只允許管理網段；追蹤 DNS（例：`awareness-training.customer.example`）只反代 `/t/*`、`/training/*`。
- 企業 CA 或公開 CA 憑證、完整鏈、到期監控與更新 owner；反向代理必須保留正確 Host。
- 防火牆只開必要方向：管理者到管理端、員工到追蹤端、平台到 SMTP／DNS／備份／監控。

遠端 Pilot 的必要環境變數：

```powershell
[Environment]::SetEnvironmentVariable('SEA_BIND_HOST', '0.0.0.0', 'Machine')
[Environment]::SetEnvironmentVariable('SEA_ALLOW_REMOTE_ADMIN', 'true', 'Machine')
[Environment]::SetEnvironmentVariable('SEA_ADMIN_HOSTNAMES', 'awareness-admin.customer.example', 'Machine')
[Environment]::SetEnvironmentVariable('SEA_TRACKING_ORIGINS', 'https://awareness-training.customer.example', 'Machine')
[Environment]::SetEnvironmentVariable('SEA_SECURE_COOKIES', 'true', 'Machine')
[Environment]::SetEnvironmentVariable('SEA_REMOTE_HTTPS_PROXY', 'true', 'Machine')
```

管理 hostname 與追蹤 hostname 不可相同；活動的 `baseUrl` 必須精確等於 `SEA_TRACKING_ORIGINS` 其中一筆。

## 2. 首次初始化碼

本機互動測試由 `run-local.ps1` 產生只存於該次程序的一次性初始化碼。Windows Service 首次初始化時，客戶管理員應在受控終端機產生短期值：

```powershell
$bootstrapBytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bootstrapBytes)
$bootstrapToken = [Convert]::ToBase64String($bootstrapBytes).TrimEnd('=').Replace('+','-').Replace('/','_')
[Environment]::SetEnvironmentVariable('SEA_BOOTSTRAP_TOKEN', $bootstrapToken, 'Machine')
$bootstrapToken  # 僅在受控終端機顯示一次，輸入首次初始化畫面
```

建立首位管理員並驗證可登入後，移除 Machine scope 值並重啟服務：

```powershell
[Environment]::SetEnvironmentVariable('SEA_BOOTSTRAP_TOKEN', $null, 'Machine')
```

平台資料庫已有管理員後不會再次初始化，但仍應移除短期秘密。

## 3. SMTP vault 主金鑰

互動 Pilot：

```powershell
.\scripts\initialize-local-secrets.ps1 -PersistForCurrentUser
```

Windows Service（需系統管理員）：

```powershell
.\scripts\initialize-local-secrets.ps1 -PersistForMachine
```

腳本不會把 `SEA_MASTER_KEY` 印到畫面。若客戶已有 CyberArk、HashiCorp Vault、Azure Key Vault 或 Windows DPAPI 規範，正式 Pilot 應以 adapter 接既有機制；不要把主金鑰放入 Git、JSON、ticket 或聊天訊息。

## 4. 報表 runtime

將核准的 `@oai/artifact-tool` 完整 runtime 放在受控部署路徑，記錄其來源與 SHA-256 manifest：

```powershell
[Environment]::SetEnvironmentVariable(
  'SEA_ARTIFACT_TOOL_MODULE',
  'D:\LocalAwareness\runtime\artifact_tool.mjs',
  'Machine'
)
```

平台不會從網路下載 runtime，也不會搜尋相鄰專案。缺少時 XLSX／Excel 功能會以 `503` fail closed。

## 5. 客戶郵件伺服器

1. 郵件管理員核准專用寄件網域／子網域、顯示名稱、SMTP host、port、TLS 模式、來源 IP 與節流上限。
2. 優先使用限制來源 IP／憑證的 relay；需要帳密時只在管理 UI 輸入一次，密碼只進 AES-GCM vault。
3. Port 587 模式強制 STARTTLS；Port 465 使用 implicit TLS。憑證必須由主機信任，平台沒有忽略憑證開關。
4. 先建立 pickup 連接器完成全流程，再建立 SMTP Draft，只用 allowlist 測試信箱執行 verify。
5. 驗證寄件、退信、DSN、郵件閘道 scanner 分類與實際節流，之後才能建立正式核准活動。
6. 若使用 Microsoft 365 Advanced Delivery，應由郵件管理員依正式流程設定精確來源、網域與 URL，不得建立全域放行。

`sent` 不等於 delivered；要在報表呈現實際投遞，需把郵件閘道／SMTP 的 DSN 或退信資料依 API 格式匯入。

## 6. Windows Service

本專案不自動下載 service wrapper。客戶若核准 NSSM：

```powershell
.\scripts\install-windows-service.ps1 -NssmPath 'D:\ApprovedTools\nssm.exe'
```

腳本會先執行 build，建立但不啟動服務。啟動前確認 Machine scope 環境、反向代理、ACL、服務帳號、pickup／report／vault 路徑與備份排程。

## 7. 備份、retention 與稽核錨點

每次 retention apply 或升級前先備份：

```powershell
.\scripts\backup-platform.ps1 `
  -DatabasePath '.local-data\platform.sqlite' `
  -BackupDirectory 'E:\ApprovedBackups\LocalAwareness'
```

先 dry-run：

```powershell
node scripts/maintenance.mjs `
  --database .local-data/platform.sqlite `
  --reports .local-data/reports `
  --pickup .local-data/pickup `
  --logs .local-data
```

核對數量、停止服務並確認備份後才加 `--apply`。還原腳本同樣預設拒絕執行，必須停服務並明確使用 `-Apply`；原資料庫及 sidecar 會改名保留。

Audit JSON 驗證：

```powershell
node scripts/verify-audit.mjs .\audit-export.json
node scripts/verify-audit.mjs .\audit-export.json --expected-final-hash '<從客戶 WORM/SIEM 取回的值>'
```

只有第二種方式能證明 final hash 與外部錨點一致；未提供外部錨點時，只代表匯出檔內一致。

## 請勿提供或設定

- 真實管理員密碼、SMTP 密碼、OAuth secret、私鑰或未核准完整員工名單給開發端。
- 巨集、可執行附件、遠端文件範本、防護規避、scanner 規避或廣泛郵件 allowlist。
- 關閉 TLS 驗證、共用 reviewer、單人自行核准，或未經 test-only 驗收直接寄正式名單。
