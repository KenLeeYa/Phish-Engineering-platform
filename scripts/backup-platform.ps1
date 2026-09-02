[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$DatabasePath,
  [Parameter(Mandatory = $true)][string]$BackupDirectory
)

$ErrorActionPreference = "Stop"
$projectDirectory = Split-Path -Parent $PSScriptRoot
$resolvedDatabase = (Resolve-Path -LiteralPath $DatabasePath).Path
$resolvedProject = (Resolve-Path -LiteralPath $projectDirectory).Path
$backupRoot = [System.IO.Path]::GetFullPath($BackupDirectory)
if ($backupRoot -eq [System.IO.Path]::GetPathRoot($backupRoot)) {
  throw "BackupDirectory 不可直接使用磁碟根目錄。"
}
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outputPath = Join-Path $backupRoot "local-awareness-$timestamp.sqlite"
& node (Join-Path $resolvedProject "scripts\backup-database.mjs") --database $resolvedDatabase --output $outputPath
if ($LASTEXITCODE -ne 0) { throw "資料庫備份失敗。" }
