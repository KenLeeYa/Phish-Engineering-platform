# 維運與成本模型

## 建議 Pilot 規格

這是容量起點，不是認證規格：4 vCPU、8 GB RAM、50 GB 加密磁碟、Windows Server 或客戶核准的 Windows 版本。Excel 報表產生會短暫使用較多 CPU／記憶體；寄送與追蹤本身較輕。SQLite 適合單機 Pilot，應將資料庫、報表與 pickup 放在受 ACL 保護的本機資料區。

平台會序列化報表產生，XLSX 單一工作表上限為 50,000 列／64 欄／750,000 cells，artifact 達 3,000 個時要求先執行 retention。這些是 Local Pilot 的資源保護界線，不是大規模壓力測試結果。

## 每月成本項目

不綁定特定雲商價格，使用下式帶入客戶既有單價：

```text
月成本 = VM/硬體攤提 + OS 授權 + DNS/TLS + 備份儲存與離線副本
       + 郵件 relay 成本 + 監控/EDR + 維運工時 + 每季還原/演練工時
```

如果使用既有 Windows VM、企業 CA、SMTP relay、備份與 EDR，新增現金支出通常主要是 VM 容量與維運工時。若另購 Windows／SQL／郵件服務，應由採購以客戶合約價估算；本文件不以公開牌價假裝成客戶實際成本。

## 人力工作量基線

- 每月：Windows／Node 安全更新、`npm audit`、備份成功、artifact／pickup／log 容量與 retention dry-run 檢查。
- 每次活動：名單 owner 確認、maker-checker、測試信箱寄送、活動監控、報表權限與 retention。
- 每季：還原演練、TLS 到期檢查、服務帳號權限、emergency stop 與 audit final-hash 外部錨點演練。
- 每年：資料保存政策、附件 allowlist、scanner 分類與郵件平台變更複核。

## 何時升級架構

只有觀測到下列壓力後才評估 PostgreSQL／獨立 worker：單機報表與寄送互相影響、SQLite lock 明顯增加、需兩台以上高可用、需跨客戶多租戶或事件保存量超出單機備份窗口。若未出現這些證據，模組化單體的維運費通常低於拆成多服務。

## SaaS 後續影響

目前刻意不做 SaaS。未來若轉為多租戶，至少要新增 tenant key、Row-Level Security 或獨立資料庫、租戶級金鑰、計量與配額、資料區域、跨租戶測試、集中身分、法遵與 on-call。這不是部署開關，而是另一個安全與維運里程碑，成本會高於目前的單客戶 Local Pilot。
