# 備份與還原

## 備份範圍

- Database：campaign、result、audit log、training、RBAC、integration registry。
- Static assets：email template attachments、training assets。
- Secret references：secret manager metadata 與 rotation 記錄。
- Config：production config，不含明文 secret。

## SQLite 部署

在停機或 write-quiet window 中備份 `data/gophish.db`，並保存 migration 版本。備份檔需加密、限制存取並記錄保留期限。

## 還原流程

1. 建立隔離環境。
2. 還原 database 與 assets。
3. 注入 secrets。
4. 啟動服務並檢查 `/readyz`。
5. 抽查 audit log、campaign、training completion 與報表聚合。
6. 完成後記錄 RTO/RPO 與差異。

## 保留與刪除

PII 與 raw event details 應依 retention policy 匿名化或刪除，只保留必要 aggregate metrics。
