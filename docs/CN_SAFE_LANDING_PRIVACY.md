# 安全演練頁提交與隱私控制

本階段建立 landing page submission 的安全預設，避免保存真實密碼、權杖、Session、Cookie 或其他敏感欄位值。

## 預設模式

系統設定 `landing_page_submission_mode` 預設為：

- `metrics_only`

在此模式下，提交事件只保存：

- `submission_mode=metrics_only`
- `submitted=true`

不保存 username、password 或其他表單欄位值。

## 支援模式

- `metrics_only`：只記錄有提交，不保存任何提交欄位值。
- `redact_sensitive_fields`：保留非敏感欄位，敏感欄位值改為 `[redacted]`。
- `disabled`：忽略提交欄位，只記錄允許的提交指標。

未知或缺失設定會安全回落到 `metrics_only`。

## 敏感欄位

會偵測並遮蔽或丟棄下列類型欄位：

- password / pass / passwd / pwd
- token / otp / mfa / 2fa
- secret / api_key / session / cookie / authorization
- credential
- credit_card / card_number / cvv
- national_id
- 密碼、驗證碼、一次性密碼、身分證、信用卡、安全碼

此外，儲存 landing page HTML 時，`input type="password"` 一律移除 `name` 屬性，避免瀏覽器提交真實密碼欄位。

## 已知限制

- 本階段先加入後端設定與安全預設，尚未提供管理 UI。
- 歷史事件若已保存敏感欄位，本 migration 不會回溯清理；後續應提供資料清理工具。
- Webhook/export/report 的敏感資料治理會在後續 integrations/reporting PR 繼續收斂。
