$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectRoot

if (-not $env:SEA_BOOTSTRAP_TOKEN) {
    $bootstrapBytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bootstrapBytes)
    $env:SEA_BOOTSTRAP_TOKEN = [Convert]::ToBase64String($bootstrapBytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
    Write-Host "首次初始化碼（僅本次啟動有效）：$env:SEA_BOOTSTRAP_TOKEN"
    Write-Host "請在首次初始化畫面輸入；完成後不需保存。"
}

if (-not $env:SEA_ARTIFACT_TOOL_MODULE) {
    $localRuntime = Join-Path $projectRoot "node_modules\@oai\artifact-tool\dist\artifact_tool.mjs"
    $developmentRuntime = Join-Path (Split-Path -Parent $projectRoot) "social-email-reporting-mvp\node_modules\@oai\artifact-tool\dist\artifact_tool.mjs"
    if (Test-Path -LiteralPath $localRuntime -PathType Leaf) {
        $env:SEA_ARTIFACT_TOOL_MODULE = (Resolve-Path -LiteralPath $localRuntime).Path
        Write-Host "報表 runtime：$env:SEA_ARTIFACT_TOOL_MODULE"
    } elseif (Test-Path -LiteralPath $developmentRuntime -PathType Leaf) {
        $env:SEA_ARTIFACT_TOOL_MODULE = (Resolve-Path -LiteralPath $developmentRuntime).Path
        Write-Warning "本次本機測試明確使用工作區既有報表 runtime：$env:SEA_ARTIFACT_TOOL_MODULE。客戶封裝必須改用核准部署路徑。"
    } else {
        Write-Warning "未設定 SEA_ARTIFACT_TOOL_MODULE；XLSX 匯入與 Excel 報表會明確回傳 503。"
    }
}

$nodeMajor = [int]((node --version).TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 24) {
    throw "需要 Node.js 24 以上版本。"
}

if (-not (Test-Path -LiteralPath "node_modules")) {
    npm ci
}

npm run build
npm start
