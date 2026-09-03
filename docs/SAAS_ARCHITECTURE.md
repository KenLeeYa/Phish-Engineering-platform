# SaaS 架構與隔離模型

## 目前交付狀態

`0.7.0` 建立 SaaS tenant-cell foundation。它提供可驗證的 tenant manifest、雙人核准、跨 tenant 衝突檢查、隔離資料根目錄、runtime 配額、容器基線、CI 與不含秘密的部署計畫。

這個版本不是 Production Ready：集中 OIDC 登入、雲端郵件 provider adapter、集中控制面 API、雲端資料庫／queue、WORM audit anchor、計費及實際 disaster-recovery 演練仍需要後續 PR 與外部帳號。未完成這些 Gate 前，只能使用核准測試信箱與 pickup／受控 SMTP Pilot。

## 目標拓樸

```text
                    宣告式控制面（Git review / 未來 Control Plane API）
 Tenant request --> registry validation --> maker-checker --> immutable digest
                                               |
                         no-secret deployment plan + secret references
                                               |
          +------------------------------------+----------------------------------+
          |                                                                       |
  Tenant A cell                                                           Tenant B cell
  admin-a.example / track-a.example                                      admin-b / track-b
  Fastify app + worker                                                    Fastify app + worker
  SQLite/PostgreSQL A                                                     SQLite/PostgreSQL B
  vault A / reports A / backup A                                          vault B / reports B / backup B
          |                                                                       |
  tenant A IdP + mail provider                                            tenant B IdP + mail provider
```

控制面只保存可公開的識別資料、網域、配額、資料區域、核准紀錄與 `secret://` reference。資料面不共用 recipient、campaign、event、report、vault 或 backup。現階段 registry 是經 Git review 的 declarative control plane；未來控制面服務也必須維持相同契約。

## 為何採 tenant cell

目前資料存取集中於 `src/infrastructure/platform-store.ts`、`content-store.ts`、`campaign-store.ts` 與 `report-store.ts`，並以單一 SQLite connection 執行。直接把 `tenant_id` 加到每張表，會讓每一個 query、migration、cache、報表、檔案路徑和背景 worker 都成為跨租戶洩漏風險。

tenant cell 重用現有成熟的單租戶資料邊界，並由 `src/config.ts` 保證 database、vault、pickup、report 都位於 `SEA_TENANT_DATA_ROOT` 之下。每個 tenant 可以獨立備份、還原、暫停、輪替金鑰與搬移資料區域；blast radius 也比較容易證明。

## 控制面契約

`src/domain/saas.ts` 定義 schema version 1：

- 身分：`tenantId`、`slug`、顯示名稱及資料區域。
- 生命週期：`draft -> pending_approval -> approved -> active -> suspended`。
- maker-checker：`requestedBy` 與 `approvedBy` 必須不同；approved／active 必須有核准時間。
- 網域：管理與追蹤 hostname 必須分離；recipient／sender domain 必須在 registry 內唯一。
- Identity：只接受 HTTPS OIDC issuer、固定 callback path 及 `clientSecretRef`。
- Delivery：provider 類型、credential reference 與 webhook secret reference。
- 平台秘密：bootstrap 與 master key 只保存 reference。
- 配額：進行中活動、單一活動收件人、月寄送量、報表 artifact 與每分鐘寄送量。
- 保存與聯絡人：recipient／event／audit 保存天數及 security／privacy／operations 聯絡點。

`scripts/plan-saas-tenant.mjs` 只對 approved／active tenant 產生計畫。計畫包含 manifest SHA-256、非秘密 runtime environment 與所需 secret reference，不會解析或輸出秘密值。

## Tenant cell 啟動契約

`src/config.ts` 在 `SEA_DEPLOYMENT_MODE=saas_tenant_cell` 時 fail closed：

- tenant ID、slug、region、manifest digest、所有配額皆必填。
- bootstrap token 與 master key 必須由 environment 或絕對路徑的唯讀 secret file 注入，且兩種來源不可同時使用。
- 管理介面必須確認 HTTPS reverse proxy、secure cookie、精確管理 Host 與精確 tracking Origin。
- 管理與追蹤 hostname 不得相同。
- database、pickup、reports、vault 必須落在 tenant data root 子路徑，不得等於根目錄或逃逸至其他 tenant。

`src/web/server.ts` 的 `/api/health` 只揭露 deployment mode、tenant ID／slug、region 與 manifest digest；不回傳路徑、秘密、recipient 或 provider credential。

## 配額執行點

- `src/application/campaign-service.ts`：建立活動前檢查 active campaign 數量。
- 同一服務在送審與排程前檢查不可變 recipient snapshot 數量。
- 排程時計算 UTC 月份內已承諾的 target 數，防止超過 monthly message quota。
- `throttlePerMinute` 不得超過 tenant 上限；原有寄送時窗、maker-checker、scope revalidation 與 emergency stop 保持不變。
- `src/application/report-service.ts`：使用 tenant artifact quota，仍由 `report-store.ts` 計數。

配額是產品與保護性限制，不是計費憑證。正式計費應使用不可變 usage ledger、provider receipt、冪等事件與對帳流程，不能直接把 SQLite count 當發票依據。

## 信任邊界

| 邊界 | 信任規則 | 失敗方式 |
|---|---|---|
| Registry | 經 schema、秘密掃描、跨租戶碰撞與 maker-checker | 拒絕產生部署計畫 |
| Orchestrator | 只接受 manifest digest 對應的計畫 | digest 不符不得啟動／更新 |
| Secret manager | secret value 不進 Git 或 plan | 缺少／無法讀取即停止啟動 |
| Admin ingress | 精確 Host、HTTPS、secure cookie、CSRF、RBAC | 未知 Host／Origin 拒絕 |
| Tracking ingress | 只開放 `/t/*`、`/training/*` 與精確 Host | token／範圍無效不記錄人員事件 |
| Delivery | 已核准 connector、寄件網域、收件範圍及 emergency stop | 任一條件失效即停止寄送 |
| Artifact runtime | 明確核准路徑與供應鏈 manifest | 缺少時報表 API 回 `503` |
| Tenant storage | 一 tenant 一 data root／backup／vault | path escape 阻止啟動 |

## Production 仍需完成

1. 實作並測試 OIDC Authorization Code + PKCE、state／nonce、MFA policy 與 group-to-role mapping；保留 break-glass 帳號程序。
2. 將 mail provider 介面擴充為 SES／SendGrid／Mailgun 等經核准 adapter，處理 webhook signature、bounce、complaint、idempotency 與 provider quota。
3. 建立真正的 control plane API、不可變 tenant revision、部署 reconciler、暫停／撤銷與 two-person promotion。
4. 依量測結果把 cell storage 升級為 managed PostgreSQL／queue／object storage；不得多 tenant 共用無 row-level isolation 證據的 schema。
5. 建立集中 observability、SIEM、WORM audit anchor、SLO、on-call、DR、restore drill 及跨租戶滲漏測試。
6. 完成台灣個資、跨境傳輸、資料處理協議、subprocessor、刪除要求與事件通報流程的法務核准。

## 不變的產品安全原則

平台只做經授權教育演練，不收真實密碼、OTP、cookie 或 session。安全 landing page 只能顯示教育內容及最小化事件；任何新功能若需要憑證蒐集、廣泛寄送放行或規避防護，必須拒絕實作。
