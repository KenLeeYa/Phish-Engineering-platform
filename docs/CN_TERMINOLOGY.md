# 繁中術語表

本術語表將目前 Gophish 與資安意識訓練常見英文術語對應為企業繁體中文用語。目標是降低攻擊性語意，強化授權訓練、教育回饋與治理意圖。

| English / Code Term | 建議繁中用語 | 使用說明 |
| --- | --- | --- |
| Gophish | 資安意識訓練平台 | 對外產品語境避免稱為 phishing toolkit。 |
| phishing | 模擬釣魚訓練 | 僅限已授權演練。 |
| phishing campaign | 模擬釣魚訓練活動 | 對應 `models.Campaign`。 |
| campaign | 訓練活動 | 一般 UI 可用較中性的「訓練活動」。 |
| target | 受訓對象 | 對應 `models.Target`，避免「目標」造成攻擊語感。 |
| recipient | 收件受訓者 | 郵件投遞語境使用。 |
| group | 受訓群組 | 對應 `models.Group`。 |
| email template | 郵件訓練樣板 | 對應 `models.Template`。 |
| landing page | 訓練落地頁 | 對應 `models.Page`。 |
| safe landing page | 安全訓練落地頁 | 不收集真實密碼或秘密。 |
| sending profile | 寄信設定檔 | 對應 `models.SMTP`。 |
| SMTP profile | SMTP 寄信設定 | 技術文件可保留 SMTP。 |
| IMAP | IMAP 回報信箱 | 用於回報郵件監控時補充用途。 |
| webhook | Webhook 整合 | 對應 `models.Webhook`。 |
| result | 受訓互動結果 | 對應 `models.Result`。 |
| event | 事件紀錄 | 對應 `models.Event`。 |
| timeline | 活動時間軸 | 報表中呈現事件流。 |
| Email Sent | 郵件已寄出 | 對應 `models.EventSent`。 |
| Email Opened | 已開啟郵件 | 對應 `models.EventOpened`。 |
| Clicked Link | 已點擊訓練連結 | 對應 `models.EventClicked`。 |
| Submitted Data | 已提交訓練表單 | 後續應避免暗示收集憑證。 |
| Email Reported | 已回報模擬郵件 | 對應 `models.EventReported`。 |
| Error Sending Email | 郵件寄送錯誤 | 對應 `models.EventSendingError`。 |
| capture credentials | 記錄訓練互動訊號 | 不應保存真實帳密。 |
| capture passwords | 禁止保存真實密碼 | 舊欄位名稱只能作為待移除技術債。 |
| credential theft | 憑證竊取 | 明確禁止。 |
| real password storage | 真實密碼保存 | 明確禁止。 |
| form submit | 表單互動事件 | 可記錄事件，不記錄秘密值。 |
| report button | 回報按鈕 | 使用者回報可疑郵件的入口。 |
| awareness training | 資安意識訓練 | 平台核心定位。 |
| learner | 受訓者 | 報表與教育內容使用。 |
| training content | 訓練內容 | 包含郵件、落地頁、教學回饋。 |
| learning objective | 學習目標 | 每個活動應明確定義。 |
| RBAC | 角色權限控管 | 對應 `models/rbac.go`。 |
| role | 角色 | 例如管理員、建立者、審核者、稽核員。 |
| permission | 權限 | 例如檢視、修改、核准、匯出。 |
| admin | 系統管理員 | 對應 `models.RoleAdmin`。 |
| user | 一般使用者 | 對應 `models.RoleUser`，後續應細分。 |
| approval workflow | 核准流程 | 投遞前必要控制。 |
| approver | 核准者 | 不應與高風險活動建立者為同一人。 |
| reviewer | 內容審查者 | 審查訓練素材與安全邊界。 |
| audit log | 稽核紀錄 | 不應與 campaign event 混用。 |
| audit trail | 稽核軌跡 | 可追溯誰在何時做了什麼。 |
| mail delivery governance | 郵件投遞治理 | 包含配額、allowlist、核准、停止與監控。 |
| allowlist | 允許清單 | 比 whitelist 更中性。 |
| blocklist | 封鎖清單 | 比 blacklist 更中性。 |
| rate limit | 速率限制 | 寄送與登入都適用。 |
| kill switch | 緊急停止開關 | 異常投遞時立即停止。 |
| data protection | 資料保護 | 個資、活動資料、secrets 的保護。 |
| PII | 個人資料 | 包含 email、姓名、部門、IP 等。 |
| data minimization | 資料最小化 | 只收集訓練必要資料。 |
| retention | 保留期限 | 到期刪除或匿名化。 |
| masking | 遮罩 | 報表與匯出隱藏敏感欄位。 |
| export governance | 匯出治理 | 匯出需權限、理由與稽核。 |
| integration | 企業整合 | IAM、HRIS、SIEM、LMS、郵件閘道等。 |
| SIEM | SIEM 資安監控整合 | 稽核與安全事件匯出。 |
| LMS | LMS 學習平台整合 | 同步訓練完成紀錄。 |
| HRIS | HRIS 人資系統整合 | 同步部門、主管與受訓對象。 |
| SSO | 單一登入 | 建議採 SAML/OIDC。 |
| SCIM | SCIM 帳號佈建 | 自動建立、停用與更新帳號。 |
| deployment hardening | 部署硬化 | TLS、secret、容器、網路、備份與監控。 |
| contact address | 聯絡窗口 | 對應 `contact_address` 與透明度 headers。 |
| transparency | 透明度資訊 | 告知此為授權訓練與聯絡窗口。 |

## 寫作用語原則

- 對管理者：使用「訓練活動」、「核准」、「稽核」、「投遞治理」、「資料保護」。
- 對受訓者：使用「模擬郵件」、「學習回饋」、「安全提示」、「回報」。
- 對工程文件：可保留原始 code term，但第一次出現時加上繁中說明。
- 避免使用會鼓勵攻擊或憑證竊取的描述，例如「偷取密碼」、「收割帳密」、「繞過防護」。
- 對舊有欄位 `capture_credentials` 與 `capture_passwords`，文件中應標為技術債與安全改造目標。
