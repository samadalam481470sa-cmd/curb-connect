<#
.SYNOPSIS
  Starts the portable PostgreSQL 17 + PostGIS used for local development on Windows.

.DESCRIPTION
  Binaries: %LOCALAPPDATA%\Programs\fieldline-pg\pgsql
  Data dir: %LOCALAPPDATA%\fieldline-pg-data
  Log file: %LOCALAPPDATA%\fieldline-pg.log
  Port:     54329 (databases fieldline_dev and fieldline_test, role fieldline)

  Safe to run repeatedly: if the server is already running it only reports its status.
  The database password lives in %LOCALAPPDATA%\fieldline-pg-pw.txt and is never printed.
  Machines with Docker can use infra/docker-compose.yml instead.

.EXAMPLE
  powershell -NoProfile -File infra\scripts\pg-start.ps1
  (requires an execution policy that allows local scripts, e.g. RemoteSigned)
#>
[CmdletBinding()]
param(
  [int]$Port = 54329
)

$ErrorActionPreference = 'Stop'

$pgRoot = Join-Path $env:LOCALAPPDATA 'Programs\fieldline-pg\pgsql'
$pgCtl = Join-Path $pgRoot 'bin\pg_ctl.exe'
$pgIsReady = Join-Path $pgRoot 'bin\pg_isready.exe'
$dataDir = Join-Path $env:LOCALAPPDATA 'fieldline-pg-data'
$logFile = Join-Path $env:LOCALAPPDATA 'fieldline-pg.log'

if (-not (Test-Path $pgCtl)) {
  throw "PostgreSQL binaries not found at $pgRoot. See README.md (Local setup) to install them."
}
if (-not (Test-Path (Join-Path $dataDir 'PG_VERSION'))) {
  throw "No initialized data directory at $dataDir. See README.md (Local setup)."
}

& $pgCtl status -D $dataDir *> $null
if ($LASTEXITCODE -eq 0) {
  Write-Host "PostgreSQL is already running (data: $dataDir)."
} else {
  Write-Host "Starting PostgreSQL on port $Port ..."
  & $pgCtl start -D $dataDir -l $logFile -o "-p $Port" -w -t 60
  if ($LASTEXITCODE -ne 0) {
    throw "pg_ctl start failed (exit $LASTEXITCODE). See $logFile."
  }
}

& $pgIsReady -h localhost -p $Port
if ($LASTEXITCODE -ne 0) {
  throw "PostgreSQL is not accepting connections on localhost:$Port."
}
