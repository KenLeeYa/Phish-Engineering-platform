# Multi-Tenant 未來規劃

Multi-tenant / MSP / SaaS 支援不是目前實作的一部分。

若未來要評估，必須先完成：

- 租戶資料隔離模型。
- 每租戶 encryption key 與 secret boundary。
- 租戶層 RBAC / ABAC。
- Audit log tenant partitioning。
- Report privacy policy per tenant。
- Mail delivery governance per tenant。
- 法務、隱私與資料處理協議。

在這些前提完成前，不應把目前 single-tenant 部署包裝成 SaaS 服務。
