# Single-Tenant 企業架構

目前平台明確定位為企業內部 single-tenant 部署：

- 一個企業/組織一套部署。
- RBAC 控制同一租戶內的職責分工。
- Campaign、recipient、training、audit、integration registry 都屬於同一租戶資料域。
- 不提供 MSP/SaaS 租戶隔離、跨租戶管理或 shared control plane。

## 安全邊界

- 只允許授權內部訓練。
- 不儲存真實密碼。
- 不收集不必要 PII。
- 報表預設聚合。
- 所有寄送必須受 approval、suppression、emergency stop 與 audit governance 約束。
