<#
.SYNOPSIS
  Stops the portable PostgreSQL used for local development on Windows (fast shutdown).

.DESCRIPTION
  Data dir: %LOCALAPPDATA%\fieldline-pg-data. Fast mode rolls back open transactions and
  disconnects clients cleanly; no data is lost. Start it again with infra\scripts\pg-start.ps1.

.EXAMPLE
  powershell -NoProfile -File infra\scripts\pg-stop.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$pgCtl = Join-Path $env:LOCALAPPDATA 'Programs\fieldline-pg\pgsql\bin\pg_ctl.exe'
$dataDir = Join-Path $env:LOCALAPPDATA 'fieldline-pg-data'

if (-not (Test-Path $pgCtl)) {
  throw "PostgreSQL binaries not found at $pgCtl."
}

& $pgCtl status -D $dataDir *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host 'PostgreSQL is not running.'
  exit 0
}

& $pgCtl stop -D $dataDir -m fast -w -t 60
if ($LASTEXITCODE -ne 0) {
  throw "pg_ctl stop failed (exit $LASTEXITCODE)."
}
Write-Host 'PostgreSQL stopped.'
