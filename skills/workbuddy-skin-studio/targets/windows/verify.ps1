$ErrorActionPreference = 'Stop'
$Root = Join-Path $PSScriptRoot '..\..'
$Cdp = if ([string]::IsNullOrWhiteSpace($env:WORKBUDDY_CDP)) { 'http://127.0.0.1:9336' } else { $env:WORKBUDDY_CDP }
$PackageDir = if ([string]::IsNullOrWhiteSpace($env:WORKBUDDY_PACKAGE_DIR)) { '.' } else { $env:WORKBUDDY_PACKAGE_DIR }
$StateArgs = @()
if (-not [string]::IsNullOrWhiteSpace($env:WORKBUDDY_STATE_DIR)) { $StateArgs = @('--state-dir', $env:WORKBUDDY_STATE_DIR) }
$NodeRunner = Join-Path $Root 'runtime\run-node-windows.ps1'
Push-Location $Root
try {
  & $NodeRunner (Join-Path $Root 'runtime\core-runner.mjs') 'verify' '--cdp' $Cdp '--package-dir' $PackageDir @StateArgs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally { Pop-Location }
