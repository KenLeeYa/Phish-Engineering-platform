# 安全強化清單

## Web 與 Session

- Production 必須啟用 TLS。
- Session cookie 應使用 Secure、HttpOnly、SameSite。
- CSRF protection 已由 `gorilla/csrf` 套用，部署時需設定 trusted origins。
- Login 與敏感 API 應保留 rate limit。

## 資料保護

- Landing page submissions 不儲存真實密碼，預設 metrics-only。
- SMTP password 不從 API 回應傳回。
- Integration payload 會移除 password、OTP、token、cookie、session 等敏感欄位。
- 報表以 aggregate-first 為預設，低於 privacy threshold 時不顯示細部資料。

## Container

- 使用非 root runtime user。
- 啟用 `no-new-privileges`。
- Drop 不必要 Linux capabilities。
- Volume 與 config 應最小權限掛載。

## 供應鏈

- CI 應加入 dependency scanning、SBOM 產生與 container scan。
- Production image 應固定 base image digest。
- 升級 Go 與 Node build image 應透過獨立 PR 驗證。
