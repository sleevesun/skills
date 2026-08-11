param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$ScriptPath,
  [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
  [string[]]$NodeArguments
)

$ErrorActionPreference = 'Stop'

function Resolve-NodeRuntime {
  $candidates = @()
  if (-not [string]::IsNullOrWhiteSpace($env:WORKBUDDY_NODE)) { $candidates += $env:WORKBUDDY_NODE }
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($null -ne $command) { $candidates += $command.Source }
  if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) { $candidates += (Join-Path $env:ProgramFiles 'nodejs\node.exe') }

  foreach ($candidate in $candidates | Where-Object { $_ } | Select-Object -Unique) {
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
    $node = (Resolve-Path -LiteralPath $candidate).Path
    $versionText = & $node --version
    if ($LASTEXITCODE -ne 0) { continue }
    $match = [regex]::Match([string]$versionText, '^v(?<major>\d+)\.(?<minor>\d+)\.\d+$')
    if (-not $match.Success) { continue }
    $major = [int]$match.Groups['major'].Value
    $minor = [int]$match.Groups['minor'].Value
    if ($major -gt 22 -or ($major -eq 22 -and $minor -ge 4)) { return $node }
  }
  throw 'Node.js 22.4 or newer is required. Install the official Node.js LTS runtime and run this launcher again.'
}

if (-not (Test-Path -LiteralPath $ScriptPath -PathType Leaf)) { throw "Runtime script not found: $ScriptPath" }
$node = Resolve-NodeRuntime
& $node $ScriptPath @NodeArguments
$exitCode = $LASTEXITCODE
if ($null -eq $exitCode) { $exitCode = 0 }
exit $exitCode
