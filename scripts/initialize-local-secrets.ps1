[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [switch]$PersistForCurrentUser,
  [switch]$PersistForMachine
)

$ErrorActionPreference = "Stop"
if ($PersistForCurrentUser -eq $PersistForMachine) {
  throw "請擇一使用 -PersistForCurrentUser（互動測試）或 -PersistForMachine（Windows Service，需系統管理員）。"
}
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$encoded = [Convert]::ToBase64String($bytes)
$scope = if ($PersistForMachine) { "Machine" } else { "User" }
$targetLabel = if ($PersistForMachine) { "Windows 機器環境" } else { "目前 Windows 使用者環境" }
if ($PSCmdlet.ShouldProcess($targetLabel, "設定 SEA_MASTER_KEY")) {
  [Environment]::SetEnvironmentVariable("SEA_MASTER_KEY", $encoded, $scope)
  Write-Host "SEA_MASTER_KEY 已保存至 $targetLabel。請重新開啟終端機或重新啟動服務；金鑰未輸出到畫面。"
}
