# 部署指南

本平台定位為企業內部 single-tenant 安全意識訓練系統，只用於授權演練與教育。

## 基本原則

- 不在 repo 中提交真實密碼、SMTP secret、API token、TLS private key。
- Production 使用 TLS，admin 與 training endpoint 都應放在受控網域與反向代理後方。
- 初始管理員密碼使用 secret manager 或部署系統注入，不寫入 compose 或 manifest。
- `config.production.example.json` 只提供欄位範例，`replace-with-secret-reference` 必須改成正式 secret reference。

## Docker Compose

`docker-compose.example.yml` 是本機/內部部署範本，production 前應：

- 改成公司核准的 image registry。
- 掛載只讀設定檔與 secret。
- 保護 `data/gophish.db` 或改接正式資料庫。
- 設定集中式 log 收集與備份。

## Health Checks

- `GET /healthz`: process-level health。
- `GET /readyz`: database readiness。

Readiness 失敗時，load balancer 不應導流。
