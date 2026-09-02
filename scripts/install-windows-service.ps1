[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = "High")]
param(
  [Parameter(Mandatory = $true)][string]$NssmPath,
  [string]$ServiceName = "LocalAwarenessPlatform",
  [string]$NodePath = "node.exe"
)

$ErrorActionPreference = "Stop"
$nssm = (Resolve-Path -LiteralPath $NssmPath).Path
$projectDirectory = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCommand) { throw "找不到 npm.cmd，無法在安裝服務前建立受驗證的 dist。" }
Push-Location -LiteralPath $projectDirectory
try {
  & $npmCommand.Source run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build 失敗，拒絕安裝服務。" }
} finally {
  Pop-Location
}
$entryPoint = Join-Path $projectDirectory "dist\index.js"
if (-not (Test-Path -LiteralPath $entryPoint -PathType Leaf)) { throw "找不到 dist\index.js。" }
if (-not [Environment]::GetEnvironmentVariable("SEA_MASTER_KEY", "Machine")) {
  Write-Warning "Machine scope 尚未設定 SEA_MASTER_KEY；Windows Service 通常無法讀取互動使用者的 User scope，SMTP 密碼 vault 可能不可用。"
}
if ($PSCmdlet.ShouldProcess($ServiceName, "使用客戶自行提供的 NSSM 安裝 Windows Service")) {
  & $nssm install $ServiceName $NodePath $entryPoint
  if ($LASTEXITCODE -ne 0) { throw "NSSM install 失敗。" }
  & $nssm set $ServiceName AppDirectory $projectDirectory
  & $nssm set $ServiceName Start SERVICE_AUTO_START
  & $nssm set $ServiceName AppStdout (Join-Path $projectDirectory ".local-data\service.stdout.log")
  & $nssm set $ServiceName AppStderr (Join-Path $projectDirectory ".local-data\service.stderr.log")
  Write-Host "服務已建立但未自動啟動。請先確認 SEA_* 系統環境、TLS 與服務帳號權限，再手動啟動。"
}
