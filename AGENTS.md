# 專案協作規則

## 產品目的

本專案只供已取得組織書面授權的內部安全意識教育與演練。所有功能、範例、測試與文件都必須維持教育目的，不得轉作憑證蒐集、規避偵測或未授權寄送。

## 不可跨越的安全邊界

- 不建立可收集、轉送或保存真實密碼、OTP、session、cookie、token 或私鑰的表單與 API。
- 不模仿真實登入流程要求受測者輸入憑證；訓練頁只記錄最小化的開啟、點擊與教育完成事件。
- 不加入防護繞過、scanner 規避、郵件廣泛放行、惡意附件、巨集、可執行檔或遠端文件範本。
- 不在 Git、tenant manifest、log、audit metadata、測試資料或部署計畫中保存秘密值或客戶個資。
- 客戶資料只可進入其隔離的 tenant data root；測試使用 `.example` 網域與合成資料。
- 寄送範圍、寄件網域、追蹤 Origin、maker-checker、emergency stop 與 TLS 控制不得因測試失敗而放寬。
- 外部 IdP、郵件、DNS、KMS、監控或雲端資源未核准時必須 fail closed，不得用假成功取代證據。

## SaaS 架構規則

- 採「宣告式控制面 + tenant-isolated cell」；每個 tenant 使用獨立資料庫、vault、報表、pickup、備份及執行邊界。
- 不可只在現有資料表加入 `tenant_id` 來宣稱多租戶安全。
- tenant 必須有唯一 ID、slug、管理 hostname、追蹤 hostname、收件與寄件網域；registry 必須拒絕跨 tenant 衝突。
- tenant 啟用必須有不同申請人與核准人，且部署使用核准 manifest 的 SHA-256 digest。
- manifest 只保存 `secret://` reference；runtime 秘密由核准 secret manager 或唯讀 secret file 注入。
- 所有 tenant 路徑必須位於該 cell 的絕對 data root 內；路徑逃逸必須阻止啟動。
- 跨 tenant 操作、共用資料庫、共用 vault、共用 artifact 目錄與未限定 hostname 一律禁止。

## 工程標準

- 先讀現有模組、測試與文件，再做最小且可追溯的修改。
- 權限、狀態、範圍與配額由後端判定；前端隱藏控制不構成授權。
- 結構化資料使用 parser 與 schema 驗證；不可用脆弱字串拼接代替。
- 錯誤訊息不得洩漏秘密、檔案內容、追蹤 token 或受測者個資。
- 新增外部 provider 時必須定義 timeout、重試、冪等、退信／complaint、限流與 emergency-stop 語意。
- 資料 migration 必須可從既有版本升級，並以整合測試覆蓋；禁止破壞性資料重建。
- 不修改與需求無關的格式、相鄰程式或歷史檔案。

## 測試期待

- 每次修改至少執行 `npm run check` 與受影響測試。
- PR Gate 執行 `npm run verify:ci`；它不包含需專有 `@oai/artifact-tool` 的完整報表閉環。
- 發佈 Gate 必須用核准 runtime 設定 `SEA_ARTIFACT_TOOL_MODULE` 後執行完整 `npm run verify`。
- SaaS 變更至少覆蓋：未知欄位、秘密值、maker-checker、跨 tenant 衝突、路徑逃逸、缺少設定、配額邊界及健康端點最小揭露。
- 部署檔需通過 parser／config 檢查；秘密掃描與 `git diff --check` 必須通過。

## Definition Of Done

- 使用者要求的行為已完成，沒有擴大寄送或資料蒐集範圍。
- 安全邊界、失敗模式、資料所有權與外部依賴已文件化。
- 新舊測試通過；無法在本機驗證的外部項目明確列為 Gate，不宣稱已完成。
- 範例不含真實網域、帳號、個資或秘密；設定只使用 reference。
- 變更可由文件中的命令重現，且不需要手動修改程式碼。
- Diff 僅包含本次需求，並附測試、風險、待辦與下一個 PR 建議。
