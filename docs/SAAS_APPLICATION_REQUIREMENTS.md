# SaaS 上線前申請資料清單

本文件列出需要由公司、IT、資安、法務或供應商先申請／核准的資訊。自動化只使用 identifier 與 `secret://` reference；請勿把密碼、client secret、API key、KMS key material 或客戶名單貼到 issue、PR、聊天或 Git。

## 第一優先：公司與治理

| 需要申請／確認 | 必要資訊 | 負責單位 | 完成證據 |
|---|---|---|---|
| 服務 owner | 公司法人名稱、產品 owner、security／privacy／operations 聯絡信箱 | 管理層 | 具名 owner 與代理人 |
| 授權政策 | 僅限內部安全意識教育、禁止憑證蒐集、允許的受測範圍 | 資安／法務 | 核准政策版本 |
| Maker-checker | tenant 申請人、獨立核准人、campaign owner、reviewer | 資安 | 角色矩陣與替代人員 |
| 資料治理 | 資料分類、處理目的、法源／同意依據、保存期限、刪除與查閱流程 | 法務／隱私 | DPIA 或內部評估、privacy notice |
| Incident response | 通報窗口、分級、停送權責、個資事件通知流程 | SOC／法務 | Runbook 與演練日期 |

台灣法遵應由法律顧問依實際業務確認；工程端的基準來源為法務部的[個人資料保護法](https://law.moj.gov.tw/LawClass/LawAll.aspx?PCode=I0050021)及個人資料保護委員會籌備處的[法令諮詢與解釋](https://www.pdpc.gov.tw/News_Html/100/)。

## 第二優先：雲端與網域

### 雲端組織

先選定 AWS、Azure、GCP 或其他核准環境，並申請：

- Organization／tenant ID、billing account、成本中心、核准 region 及資料不得離境的限制。
- Production、Staging 分離的 subscription／account／project；禁止用個人帳號持有 Production。
- 部署 service principal／workload identity，只給必要權限並設定核准者。
- Container registry、image signing、SBOM／vulnerability scan 與 immutable tag policy。
- 網路：VPC／VNet、private subnet、egress policy、firewall、WAF／DDoS、固定 outbound IP（若郵件商要求）。

### DNS 與 TLS

每個 tenant 應先取得：

- 獨立管理 hostname，例如 `awareness-admin.customer.example`。
- 獨立追蹤／教育 hostname，例如 `awareness-training.customer.example`。
- 寄件子網域，例如 `training-mail.customer.example`；不建議直接使用企業主要郵件網域。
- DNS zone ID、DNS 變更申請流程、domain owner、憑證簽發方式及自動更新責任人。
- SPF、DKIM、DMARC、MX／return-path 與 provider 驗證紀錄的核准變更單。

若採 Cloudflare，完整 zone setup 需要 domain registrar 可變更 nameserver；官方流程見 [Cloudflare DNS full setup](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/)。其他 DNS 供應商也需保留相同的 ownership 與變更證據。

## 第三優先：企業身分 IdP

申請 OIDC application registration，至少提供下列非秘密資料：

- Issuer／tenant ID、client ID、正式與 Staging redirect URI。
- 固定 Production callback：`https://<admin-host>/api/auth/oidc/callback`。
- client secret 或私鑰的 secret-manager reference，以及 rotation owner／到期日；不要提供實際值。
- 必要 claims：穩定 user ID、email、display name、group／role claim。
- 群組對應：system admin、campaign creator、reviewer、report viewer；最小權限與離職停權流程。
- MFA／Conditional Access、session lifetime、測試帳號、break-glass 與登入稽核保存方式。

Microsoft Entra 必須把 redirect URI 精確登錄，未登錄 URI 會被拒絕；參考 [Microsoft identity platform redirect URI restrictions](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url)。

目前程式只把 OIDC 設定納入 manifest 與 readiness contract，尚未取代本機帳密登入；在 OIDC PR 與真實 IdP E2E 完成前不可宣稱 SSO 上線。

## 第四優先：郵件寄送供應商

選定企業 SMTP relay、AWS SES、SendGrid、Mailgun 或其他經核准供應商，申請：

- 帳號／project／region、Production sending access、每日與每秒速率 quota。
- 已驗證寄件子網域、From address、return-path、DKIM selector、SPF 與 DMARC policy。
- API credential／SMTP credential 的 secret reference、rotation owner、來源 IP 或 workload identity 限制。
- Bounce／complaint webhook URL、signature secret reference、重試與保留期限。
- Suppression policy、abuse contact、emergency stop、供應商事故與退場程序。
- 僅限核准 recipient domain／test mailbox 的 Pilot；Production 擴大範圍需另行核准。

AWS SES 新帳號通常先在 sandbox；正式寄送需提出 production access request，並提交 mail type、網站、聯絡人與寄送流程等資料，見 [AWS SES production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html)。

`sent` 只代表 provider 接受，不能宣稱 delivered；報表需要 bounce／DSN／provider event 才能提升投遞證據。

## 第五優先：秘密、資料與備援

- Secret manager／vault：服務身分、vault ID、讀取 policy、rotation、break-glass、存取 audit。
- KMS／HSM：key alias／ID、region、用途、rotation、disable／revoke、雙人核准及 recovery policy。
- Tenant database：每 tenant instance／database 邊界、加密、連線身分、備份、PITR、maintenance window。
- Queue：tenant namespace、dead-letter queue、visibility timeout、idempotency key、重送上限。
- Object storage：tenant bucket／prefix policy、SSE-KMS、versioning、retention、legal hold 與 signed-download TTL。
- Backup：獨立帳號／vault、immutable copy、RPO／RTO、還原演練、資料區域及刪除證據。
- 核准 `@oai/artifact-tool` runtime 套件、來源、版本、SHA-256 manifest、更新與撤銷程序。

目前 SQLite cell 可做隔離 Pilot；managed database／queue／object storage 是高可用 Production 的後續 Gate，不能只靠 Docker volume 宣稱完成。

## 第六優先：監控與營運

- Log／metric／trace 平台 workspace、資料區域、保存期限及 PII redaction 規則。
- SIEM ingestion endpoint、service identity、audit final-hash WORM anchor。
- Alert route、on-call schedule、P1/P2 閾值、status page 與客戶通報窗口。
- Synthetic monitoring 的核准測試 tenant／mailbox；不得用真實員工測試。
- SLO：管理 API、tracking endpoint、queue delay、報表生成、bounce lag 及 restore objective。

## 選配：計費與商務

需要自助訂閱時才申請 payment provider。以 Stripe 為例，需要公司／代表人驗證、銀行帳戶、稅務資料、statement descriptor、2FA、webhook endpoint 與 restricted key；官方起始流程見 [Stripe account setup](https://docs.stripe.com/get-started/account/set-up)。

計費、invoice、tax、refund、trial、subscription lifecycle 與 usage reconciliation 尚未實作，不是目前 `0.7.0` 的能力。

## 每個 Tenant Onboarding 必填資料

1. Tenant ID、slug、正式名稱、資料區域與 security／privacy／operations 聯絡信箱。
2. 申請人、獨立核准人、申請／核准時間及生命周期狀態。
3. 精確 admin host、tracking host、recipient domains、sender domains 及 DNS ownership 證據。
4. OIDC issuer、client ID、redirect URI、role claim 及 client-secret reference。
5. Delivery provider、credential reference、webhook-secret reference、核准 quota。
6. Bootstrap／master-key reference、recipient／event／audit retention、活動與報表配額。
7. Pilot test mailbox、campaign reviewer、emergency-stop owner、backup owner 與 incident contact。

先填寫 `config/saas-tenants.example.json` 的副本，經不同人 review 後再產生 deployment plan。實際檔案應放在受控設定庫，不應提交到公開 repository。
