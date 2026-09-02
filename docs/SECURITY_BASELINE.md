# Local Pilot 安全基線

## 使用範圍

本平台只供客戶已書面授權的內部安全意識演練。不得用於取得憑證、規避郵件防護、對外部第三方寄送、執行巨集／程式或建立遠端文件追蹤。

## 已落實控制

| 風險 | 控制 | 驗證證據 |
|---|---|---|
| 未授權首次管理員 | 啟動時一次性 bootstrap token；初始化後不可重做 | security-hardening integration |
| 帳密猜測與帳號生命週期 | scrypt、未知帳號 dummy verify、IP／帳號節流、強制換密碼、停用／改角／重設即撤銷 session | security + integration tests |
| 越權讀取 | 四角色 read/write permissions；reviewer 不讀名單／connector；非管理員不讀 scope | RBAC negative tests |
| 自我核准／偷換名單 | maker-checker、不可變 recipient snapshot、delivery-critical digest、排程重算 | full-pilot mutable-roster test |
| 活動範圍漂移 | 精確 tracking Origin；排程及逐封寄送重新檢查收件／寄件／test mailbox／connector | exact-origin + scope-revoke tests |
| Tracking token 外洩／重播 | 256-bit token、logger URL redaction、寄送後 plaintext 清除、expiry／revoke、事件去重 | redaction + token lifecycle tests |
| 偽造高信賴證據 | 只接受附件開啟／退信、來源 digest／reference／event ID、核准附件與有效時段、maker 不可匯入 | provenance + replay tests |
| 不受信任 EML／附件 | 不保存 raw headers、HTML sanitizer、sandbox、被動附件 allowlist、巨集／執行檔／遠端範本隔離 | template safety tests |
| XLSX 壓縮炸彈／路徑／formula | ZIP central-directory preflight、解壓與工作表上限、加密／ZIP64／路徑／VBA 拒絕、輸出文字防 formula injection | spreadsheet security tests |
| 報表資源耗盡／artifact 置換 | 單一 generation lock、輸入／列數／artifact 總量上限、root／size／SHA-256 驗證 | type/integration + artifact tests |
| Audit 截斷／過度宣稱 | 匯出全部記錄與首尾邊界、檔內 hash chain、明確 assurance；可比對外部 final-hash anchor | >10k export test + verifier |
| 保存期限不完整 | dry-run/apply 涵蓋 session、事件、token、活動、報表、名單、pickup、log、audit | operations integration |
| SMTP 中間人／秘密外洩 | STARTTLS 或 implicit TLS、憑證驗證、AES-256-GCM vault、SQLite／API／audit 不含密碼 | source tests；真實 relay 為客戶 Gate |

## 已知邊界

- 本次自動寄送證據使用 pickup；真實 SMTP、DNS、TLS、反向代理與郵件閘道必須在客戶 Pilot 驗收。
- SQLite 適用單機 Pilot，不宣稱多機 HA。
- IP 僅以每次程序隨機 salt 產生不可逆 fingerprint；原始 IP 不進事件資料或 request log。客戶匯入的 rawdata 若含來源 IP，Excel rawdata 仍屬敏感報表，應依 ACL 與 retention 管理。
- 開信可能由圖片代理或自動載入造成；scanner 事件分開，但分類不是百分之百的人員身分證明。
- 真正 MIME 附件在郵件程式內的開啟沒有可靠 callback；平台只承認受控附件端點或客戶端稽核證據。
- Audit hash chain 沒有內建可信時間戳；未使用外部 anchor 時只能證明單一匯出檔的內部一致性。

## 發布前檢查

```powershell
$env:SEA_ARTIFACT_TOOL_MODULE = 'D:\ApprovedRuntime\artifact_tool.mjs'
npm run verify
npm audit --audit-level=moderate
node scripts/check-database.mjs .local-data/platform.sqlite
```

任何檢查失敗、實際 SMTP/TLS 未驗證或客戶 Gate 未簽核時，不得宣稱 Production Ready。
