# 災難復原

## 目標

- RTO：待企業依服務等級定義。
- RPO：待企業依資料保護要求定義。

## DR Checklist

- 可用的最新 database backup。
- 可用的 static/training assets backup。
- Secret manager 可還原或重新簽發。
- DNS 與 TLS certificate 可切換。
- SMTP sending profile 可重新審核。
- `/readyz` 通過後才恢復導流。

## 復原後驗證

- 登入與 RBAC。
- Campaign approval workflow。
- Safe landing page submission mode。
- Delivery queue 與 suppression enforcement。
- Training assignment/completion。
- Aggregate report summary。
- Audit log 查詢。
