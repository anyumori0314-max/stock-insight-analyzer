<#
.SYNOPSIS
  Runs the daily Stock Insight Analyzer maintenance job (CSV import + provider
  top-up) and writes a timestamped log. Intended for Windows Task Scheduler.

.DESCRIPTION
  - Resolves the project root from the script's own location (no hard-coded path).
  - Delegates all data logic to `npm run data:daily`; the Node process reads
    configuration from the project .env. This script NEVER reads, prints or
    hard-codes the API key or any .env contents.
  - Prevents overlapping runs with a global mutex (the database job-lock is the
    authoritative guard; this is an extra, fast pre-check).
  - Preserves the Node process exit code so the scheduler can detect failures
    (0 ok · 1 input error · 2 db error · 3 concurrent run rejected).

.PARAMETER CsvDirectory
  Optional directory of CSV files to import before syncing.

.PARAMETER Tickers
  Optional comma-separated ticker list (e.g. "AAPL,MSFT,NVDA"). When omitted the
  job uses STOCK_SYNC_TICKERS from .env.

.PARAMETER LogDirectory
  Where to write logs. Defaults to <project>\.cache\logs (git-ignored).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\run-daily-stock-update.ps1 `
    -CsvDirectory "D:\market-data\daily" -Tickers "AAPL,MSFT,NVDA"

.NOTES
  Register with Task Scheduler MANUALLY (this script never registers itself).
  See docs/DATA_PIPELINE.md for a ready-to-paste `schtasks` example.
#>
#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$CsvDirectory,
  [string]$Tickers,
  [string]$LogDirectory
)

# Resolve the project root: this script lives in <root>\scripts.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir

if (-not $LogDirectory) {
  $LogDirectory = Join-Path $ProjectRoot '.cache\logs'
}
New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
$LogFile = Join-Path $LogDirectory ("daily-stock-update-{0}.log" -f (Get-Date -Format 'yyyyMMdd'))

function Write-Log([string]$Message) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'o'), $Message
  Add-Content -Path $LogFile -Value $line
}

# Fast overlap pre-check (the DB job-lock is the real guard).
$mutex = New-Object System.Threading.Mutex($false, 'Global\StockInsightDailyUpdate')
if (-not $mutex.WaitOne(0)) {
  Write-Log "Another daily run is already in progress; exiting with code 3."
  exit 3
}

try {
  Push-Location $ProjectRoot
  try {
    $npmArgs = @('run', 'data:daily', '--')
    if ($CsvDirectory) { $npmArgs += @('--csv-directory', $CsvDirectory) }
    if ($Tickers)      { $npmArgs += @('--tickers', $Tickers) }

    Write-Log "Starting data:daily (csvDirectory='$CsvDirectory', tickers='$Tickers')."
    # Capture stdout+stderr into the log. The job logs structured JSON and never
    # emits secrets, so the log is safe to retain.
    & npm @npmArgs *>> $LogFile
    $code = $LASTEXITCODE
    Write-Log "data:daily exited with code $code."
    exit $code
  }
  finally {
    Pop-Location
  }
}
finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
