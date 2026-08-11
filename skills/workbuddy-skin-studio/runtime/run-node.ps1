param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$ScriptPath,
  [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
  [string[]]$NodeArguments
)

$ErrorActionPreference = 'Stop'

function Resolve-WorkBuddyExecutable {
  $explicit = $env:WORKBUDDY_EXECUTABLE
  $candidates = @()
  if (-not [string]::IsNullOrWhiteSpace($explicit)) { $candidates += $explicit }

  $packages = @(Get-AppxPackage -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'WorkBuddy' } | Sort-Object Version -Descending)
  foreach ($package in $packages) {
    try {
      $manifest = Get-AppxPackageManifest -Package $package -ErrorAction Stop
      foreach ($application in @($manifest.Package.Applications.Application)) {
        $relative = [string]$application.Executable
        if (-not [string]::IsNullOrWhiteSpace($relative)) { $candidates += (Join-Path $package.InstallLocation $relative) }
      }
    } catch { }
    $candidates += (Join-Path $package.InstallLocation 'WorkBuddy.exe')
    $candidates += (Join-Path $package.InstallLocation 'Electron.exe')
    $candidates += (Join-Path $package.InstallLocation 'app\WorkBuddy.exe')
    $candidates += (Join-Path $package.InstallLocation 'app\Electron.exe')
  }

  $programFiles = if ($env:ProgramFiles) { $env:ProgramFiles } else { '' }
  $programFilesX86Value = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
  $programFilesX86 = if ($programFilesX86Value) { $programFilesX86Value } else { '' }
  $localAppData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { '' }
  $candidates += @(
    (Join-Path $programFiles 'WorkBuddy\WorkBuddy.exe'),
    (Join-Path $programFilesX86 'WorkBuddy\WorkBuddy.exe'),
    (Join-Path $localAppData 'WorkBuddy\WorkBuddy.exe'),
    (Join-Path $localAppData 'Programs\WorkBuddy\WorkBuddy.exe')
  )

  foreach ($candidate in $candidates | Where-Object { $_ } | Select-Object -Unique) {
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
    if ([IO.Path]::GetExtension($candidate) -ine '.exe') { continue }
    $resolved = (Resolve-Path -LiteralPath $candidate).Path
    $signature = Get-AuthenticodeSignature -LiteralPath $resolved
    if ($signature.Status -eq 'Valid') { return $resolved }
  }
  throw 'A signed WorkBuddy executable was not found.'
}

function Resolve-NodeRuntime([string]$WorkBuddyExecutable) {
  if (-not [string]::IsNullOrWhiteSpace($env:WORKBUDDY_NODE)) {
    if (-not (Test-Path -LiteralPath $env:WORKBUDDY_NODE -PathType Leaf)) {
      throw 'WORKBUDDY_NODE is not an executable file.'
    }
    return [pscustomobject]@{ Path = (Resolve-Path -LiteralPath $env:WORKBUDDY_NODE).Path; Electron = $false }
  }

  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($null -ne $node) {
    return [pscustomobject]@{ Path = $node.Source; Electron = $false }
  }
  return [pscustomobject]@{ Path = $WorkBuddyExecutable; Electron = $true }
}

if (-not (Test-Path -LiteralPath $ScriptPath -PathType Leaf)) { throw "Runtime script not found: $ScriptPath" }
$workBuddyExecutable = Resolve-WorkBuddyExecutable
$env:WORKBUDDY_EXECUTABLE = $workBuddyExecutable
$runtime = Resolve-NodeRuntime $workBuddyExecutable
$oldElectronMode = $env:ELECTRON_RUN_AS_NODE
try {
  if ($runtime.Electron) { $env:ELECTRON_RUN_AS_NODE = '1' }
  & $runtime.Path $ScriptPath @NodeArguments
  $exitCode = $LASTEXITCODE
} finally {
  if ($null -eq $oldElectronMode) { Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue }
  else { $env:ELECTRON_RUN_AS_NODE = $oldElectronMode }
}
if ($null -eq $exitCode) { $exitCode = 0 }
exit $exitCode
