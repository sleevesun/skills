param([switch]$DryRun)
$ErrorActionPreference = 'Stop'
$Root = Join-Path $PSScriptRoot '..\..'
$Cdp = if ([string]::IsNullOrWhiteSpace($env:WORKBUDDY_CDP)) { 'http://127.0.0.1:9336' } else { $env:WORKBUDDY_CDP }
$PackageDir = if ([string]::IsNullOrWhiteSpace($env:WORKBUDDY_PACKAGE_DIR)) { '.' } else { $env:WORKBUDDY_PACKAGE_DIR }
$StateArgs = @()
if (-not [string]::IsNullOrWhiteSpace($env:WORKBUDDY_STATE_DIR)) { $StateArgs = @('--state-dir', $env:WORKBUDDY_STATE_DIR) }
$NodeRunner = Join-Path $Root 'runtime\run-node-windows.ps1'

function Show-LauncherError([string]$Message) {
  try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
    [System.Windows.Forms.MessageBox]::Show($Message, 'WorkBuddy Theme', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  } catch { }
}

function Get-RuntimeFailure([object[]]$Output, [int]$ExitCode, [string]$Stage) {
  $Details = ($Output | Out-String).Trim()
  if ([string]::IsNullOrWhiteSpace($Details)) { return "$Stage failed with exit code $ExitCode." }
  return "$Stage failed.`r`n`r`n$Details"
}

trap {
  Show-LauncherError $_.Exception.Message
  exit 1
}

if ($DryRun) {
  Push-Location $Root
  try {
    $DryRunOutput = & $NodeRunner (Join-Path $Root 'runtime\core-runner.mjs') 'dry-run' '--cdp' $Cdp '--package-dir' $PackageDir @StateArgs 2>&1
    if ($LASTEXITCODE -ne 0) { throw (Get-RuntimeFailure $DryRunOutput $LASTEXITCODE 'Theme preparation') }
    $DryRunOutput
  } finally { Pop-Location }
  exit 0
}
Push-Location $Root
try {
  $PreparedJson = & $NodeRunner (Join-Path $Root 'runtime\core-runner.mjs') 'dry-run' '--cdp' $Cdp '--package-dir' $PackageDir @StateArgs 2>&1
  if ($LASTEXITCODE -ne 0) { throw (Get-RuntimeFailure $PreparedJson $LASTEXITCODE 'Theme preparation') }
} finally { Pop-Location }
$Prepared = $PreparedJson | ConvertFrom-Json
Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
$Choice = [System.Windows.Forms.MessageBox]::Show('The theme package is ready. Restart WorkBuddy and apply the theme now?', 'WorkBuddy Theme', [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question)
if ($Choice -ne [System.Windows.Forms.DialogResult]::Yes) { exit 0 }
Push-Location $Root
try {
  $ApplyOutput = & $NodeRunner (Join-Path $Root 'runtime\core-runner.mjs') 'apply' '--confirm-token' $Prepared.confirmToken '--restart' '--watch' '--cdp' $Cdp '--package-dir' $PackageDir @StateArgs 2>&1
  if ($LASTEXITCODE -ne 0) { throw (Get-RuntimeFailure $ApplyOutput $LASTEXITCODE 'Theme application') }
} finally { Pop-Location }
[void]($ApplyOutput | ConvertFrom-Json)
[System.Windows.Forms.MessageBox]::Show('Theme applied and verified successfully.', 'WorkBuddy Theme', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
