# SaaS Tenant Cell 維運手冊

## 安全前提

- 只處理經授權的內部教育演練，測試先使用 `.example` 合成資料或客戶核准 test mailbox。
- Tenant registry 只放 identifier、domain、quota、approval 與 `secret://` reference。
- 真實 secret 由 secret manager 或權限受限的 secret file 注入；不可寫入 `.env`、plan、log 或 shell history。
- 一個 cell 只服務一個 tenant；database、vault、reports、pickup、backup 與 hostname 不共用。

## 驗證 Registry

```powershell
npm ci
npm run saas:validate
```

對受控 registry 驗證：

```powershell
npm run build
node scripts/plan-saas-tenant.mjs `
  --registry C:\SecureConfig\saas-tenants.json `
  --validate-only
```

驗證會拒絕未知欄位、疑似秘密值、錯誤 URL／網域、相同申請與核准人、跨 tenant 衝突及不完整配額。

## 產生不可變部署計畫

```powershell
node scripts/plan-saas-tenant.mjs `
  --registry C:\SecureConfig\saas-tenants.json `
  --tenant tenant-customer-001 `
  --data-root D:\SecurityAwareness\Tenants `
  --output .local-data\plans\tenant-customer-001.json
```

輸出包含 manifest SHA-256、runtime environment 與 required secret references，不含 secret value。部署系統應保存 plan、Git commit、container digest、SBOM 及核准單，並在啟動前比對 `SEA_TENANT_CONFIG_DIGEST`。

## 本機容器驗證

`deploy/saas/docker-compose.example.yml` 是單一 tenant cell 參考，不是多租戶共享 compose。先由 secret manager 匯出兩個暫存唯讀檔，限制 ACL，結束後依組織程序銷毀；不要把值貼入命令列。

需要提供的非秘密環境變數：

```text
SEA_TENANT_ID
SEA_TENANT_SLUG
SEA_DATA_REGION
SEA_TENANT_CONFIG_DIGEST
SEA_ADMIN_HOSTNAMES
SEA_TRACKING_ORIGINS
SEA_MAX_ACTIVE_CAMPAIGNS
SEA_MAX_RECIPIENTS_PER_CAMPAIGN
SEA_MAX_MONTHLY_MESSAGES
SEA_MAX_REPORT_ARTIFACTS
SEA_MAX_THROTTLE_PER_MINUTE
SEA_ARTIFACT_RUNTIME_DIRECTORY
SEA_BOOTSTRAP_SECRET_FILE
SEA_MASTER_KEY_SECRET_FILE
```

檢查 compose 展開後再啟動：

```powershell
docker compose --file deploy/saas/docker-compose.example.yml config --quiet
docker compose --file deploy/saas/docker-compose.example.yml up --build --detach
```

容器以非 root UID `10001`、唯讀 root filesystem、移除 Linux capabilities、`no-new-privileges` 執行；只有 `/tenant` volume 與 `/tmp` 可寫。Port 預設只綁 loopback，Production 必須放在核准 HTTPS reverse proxy／load balancer 後方。

## 啟動與健康檢查

啟動成功後，以正確管理 Host 經 HTTPS 呼叫 `/api/health`。應確認：

- `deploymentMode` 為 `saas_tenant_cell`。
- `tenant.id`、`tenant.dataRegion` 與核准 plan 相符。
- `tenant.configDigest` 等於核准 manifest digest。
- `emergencyStop` 符合變更單；未核准寄送前保持啟用。
- 回應不存在 filesystem path、secret、recipient PII 或 connector credential。

啟動前任何必填值、秘密檔、HTTPS 宣告、Host／Origin 分離、配額或 path containment 失敗，程序都應直接停止。

## Release Gate

```powershell
$env:SEA_ARTIFACT_TOOL_MODULE = 'D:\ApprovedRuntime\artifact_tool.mjs'
npm ci
npm run verify
npm audit --omit=dev --audit-level=high
git diff --check
```

GitHub CI 執行 `npm run verify:ci`，會跑 TypeScript、一般整合測試與 SaaS registry 驗證。完整報表閉環依賴不可提交的核准 artifact runtime，因此 release machine 必須另外執行 `npm run verify`；兩個 Gate 都要成功。

## 備份與還原

- 每個 tenant 使用獨立 backup target、encryption key、retention 及 restore authorization。
- 備份前記錄 tenant ID、manifest digest、application image digest、DB migration version 與 audit final hash。
- 還原只能進同 tenant 的隔離 staging cell，先執行 integrity check 與 smoke test，禁止還原到其他 tenant。
- Production restore 需要 maker-checker、維護公告、寄送 emergency stop、DNS／queue 隔離與回復驗證。
- 定期執行實際 restore drill；只有存在時間、結果、RPO／RTO 與核准人的紀錄才算通過。

## 變更 Tenant 設定

1. 從目前核准 revision 建立新 manifest revision。
2. 修改 domain、quota、retention、provider 或 secret reference；不要放 secret value。
3. 執行 registry validation 與測試，由非申請人核准。
4. 產生新 plan 與 digest，先部署 Staging tenant cell。
5. 驗證登入、RBAC、test mailbox、bounce、report、audit 與 rollback。
6. Production promotion 綁定同一 commit、manifest digest 與 image digest。

Secret rotation 不應改變 manifest，只更新 secret manager 中 reference 指向的版本並保留 rotation receipt。若 reference 本身改變，視為設定 revision，重新走核准。

## 事故處理

發現跨租戶疑慮、未知寄送、provider complaint、秘密洩漏或 audit 不一致時：

1. 啟用該 tenant emergency stop，暫停 worker 與 ingress；不要刪除證據。
2. 撤銷 provider credential、OIDC secret／certificate 與受影響 session。
3. 保存 container／manifest digest、audit export、provider receipt、WAF／IdP log 及時間線。
4. 依 privacy／incident runbook 通知 security、privacy、operations 與必要客戶窗口。
5. 在隔離環境重現與修復，完成跨租戶與回歸測試後才可由雙人核准恢復。

## 目前不可自動完成的外部 Gate

雲端帳號建立、網域 ownership、DNS 變更、TLS 簽發、IdP application、郵件 production access、KMS、支付 KYC、法務核准與真實 restore drill 都需要組織或供應商權限。自動化可以驗證 identifier、reference、設定與回執，但不能代替這些核准，也不會要求你提供秘密值。
