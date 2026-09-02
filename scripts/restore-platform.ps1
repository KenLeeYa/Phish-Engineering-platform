[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = "High")]
param(
  [Parameter(Mandatory = $true)][string]$DatabasePath,
  [Parameter(Mandatory = $true)][string]$BackupPath,
  [switch]$Apply
)

$ErrorActionPreference = "Stop"
if (-not $Apply) { throw "還原預設不執行。確認服務已停止後，加上 -Apply 並接受 PowerShell confirmation。" }
$projectDirectory = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$resolvedBackup = (Resolve-Path -LiteralPath $BackupPath).Path
$targetPath = [System.IO.Path]::GetFullPath($DatabasePath)
$targetDirectory = Split-Path -Parent $targetPath
if ($targetDirectory -eq [System.IO.Path]::GetPathRoot($targetDirectory)) { throw "DatabasePath 不可位於磁碟根目錄。" }
if ($resolvedBackup -eq $targetPath) { throw "BackupPath 與 DatabasePath 不可相同。" }
New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
$temporary = Join-Path $targetDirectory ("restore-check-" + [guid]::NewGuid().ToString("N") + ".sqlite")
Copy-Item -LiteralPath $resolvedBackup -Destination $temporary
try {
  & node (Join-Path $projectDirectory "scripts\check-database.mjs") $temporary
  if ($LASTEXITCODE -ne 0) { throw "備份檔 SQLite 完整性驗證失敗。" }
  if ($PSCmdlet.ShouldProcess($targetPath, "以已驗證備份還原資料庫")) {
    if (Test-Path -LiteralPath $targetPath) {
      $safetyCopy = "$targetPath.pre-restore-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
      Move-Item -LiteralPath $targetPath -Destination $safetyCopy
      Write-Host "原資料庫已保留於 $safetyCopy"
    }
    foreach ($suffix in @("-wal", "-shm")) {
      $sidecar = "$targetPath$suffix"
      if (Test-Path -LiteralPath $sidecar) {
        Move-Item -LiteralPath $sidecar -Destination "$sidecar.pre-restore-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
      }
    }
    Move-Item -LiteralPath $temporary -Destination $targetPath
    Write-Host "還原完成：$targetPath"
  }
} finally {
  if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
}
