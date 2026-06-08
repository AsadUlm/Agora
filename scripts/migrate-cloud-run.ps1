<#
.SYNOPSIS
  Run Alembic migrations against Cloud SQL (PostgreSQL) via the Cloud SQL
  Auth Proxy, from a Windows developer machine or CI pipeline.

.DESCRIPTION
  1. Starts Cloud SQL Auth Proxy (TCP mode) on a local port.
  2. Builds a DATABASE_URL pointing at that local port.
  3. Runs `alembic upgrade <target>` in the server/.venv environment.
  4. Stops the proxy after the migration completes (or fails).

.PARAMETER CloudSqlInstance
  GCP Cloud SQL instance connection name.
  Format: <project>:<region>:<instance-id>
  E.g.  : my-project:europe-west1:agora-prod

.PARAMETER DbName
  PostgreSQL database name (default: agora).

.PARAMETER DbUser
  PostgreSQL user (default: agora-app).

.PARAMETER DbPassword
  PostgreSQL user password (required).

.PARAMETER ProxyPort
  Local TCP port for the proxy (default: 5433).

.PARAMETER ProxyPath
  Path to the cloud-sql-proxy executable (default: cloud-sql-proxy).

.PARAMETER AlembicTarget
  Alembic revision target passed to `upgrade` (default: head).

.EXAMPLE
  $env:CLOUD_SQL_INSTANCE = "my-project:europe-west1:agora-prod"
  $env:DB_PASSWORD         = "s3cr3t"
  ./scripts/migrate-cloud-run.ps1

.EXAMPLE
  ./scripts/migrate-cloud-run.ps1 `
      -CloudSqlInstance "my-project:europe-west1:agora-prod" `
      -DbPassword "s3cr3t" `
      -AlembicTarget "head"

.NOTES
  Prerequisites:
    - gcloud CLI authenticated: gcloud auth application-default login
    - cloud-sql-proxy in PATH or -ProxyPath set
    - server/.venv with project dependencies installed
#>
[CmdletBinding()]
param(
    [string]$CloudSqlInstance = $(if ($env:CLOUD_SQL_INSTANCE) { $env:CLOUD_SQL_INSTANCE } else { "" }),
    [string]$DbName           = $(if ($env:DB_NAME)            { $env:DB_NAME }            else { "agora" }),
    [string]$DbUser           = $(if ($env:DB_USER)            { $env:DB_USER }            else { "agora-app" }),
    [string]$DbPassword       = $(if ($env:DB_PASSWORD)        { $env:DB_PASSWORD }        else { "" }),
    [int]   $ProxyPort        = $(if ($env:PROXY_PORT)         { [int]$env:PROXY_PORT }    else { 5433 }),
    [string]$ProxyPath        = $(if ($env:CLOUD_SQL_PROXY_PATH){ $env:CLOUD_SQL_PROXY_PATH } else { "cloud-sql-proxy" }),
    [string]$AlembicTarget    = $(if ($env:ALEMBIC_TARGET)     { $env:ALEMBIC_TARGET }     else { "head" })
)

$ErrorActionPreference = "Stop"

function Write-Log  ([string]$msg) { Write-Host "[migrate] $msg" -ForegroundColor Cyan }
function Write-Fail ([string]$msg) { Write-Host "[migrate] ERROR: $msg" -ForegroundColor Red; exit 1 }

# ── Validate required parameters ─────────────────────────────────────────────
if (-not $CloudSqlInstance) {
    Write-Fail "CloudSqlInstance is required. Set CLOUD_SQL_INSTANCE env var or pass -CloudSqlInstance."
}
if (-not $DbPassword) {
    Write-Fail "DbPassword is required. Set DB_PASSWORD env var or pass -DbPassword."
}

# ── Locate project paths ──────────────────────────────────────────────────────
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot   = Resolve-Path (Join-Path $ScriptDir "..")
$ServerDir  = Join-Path $RepoRoot "server"
$VenvAlembic = Join-Path $ServerDir ".venv\Scripts\alembic.exe"

if (-not (Test-Path $VenvAlembic)) {
    Write-Fail "Alembic not found at $VenvAlembic. Run: cd server ; python -m venv .venv ; pip install -r requirements.txt"
}
if (-not (Get-Command $ProxyPath -ErrorAction SilentlyContinue)) {
    Write-Fail "'$ProxyPath' not found in PATH. Download: https://cloud.google.com/sql/docs/postgres/sql-proxy"
}

# ── Start Cloud SQL Auth Proxy ────────────────────────────────────────────────
Write-Log "Starting Cloud SQL Proxy for $CloudSqlInstance on 127.0.0.1:$ProxyPort"

$ProxyArgs  = "--instances=${CloudSqlInstance}=tcp:${ProxyPort}"
$ProxyProc  = Start-Process -FilePath $ProxyPath -ArgumentList $ProxyArgs -PassThru -WindowStyle Hidden

# Give the proxy a moment to connect.
Start-Sleep -Seconds 3

try {
    # ── Build DATABASE_URL pointing at the proxy ───────────────────────────────
    $CloudDatabaseUrl = "postgresql+asyncpg://${DbUser}:${DbPassword}@127.0.0.1:${ProxyPort}/${DbName}"

    # ── Run migrations ─────────────────────────────────────────────────────────
    Write-Log "Running: alembic upgrade $AlembicTarget"

    Push-Location $ServerDir
    try {
        $env:DATABASE_URL = $CloudDatabaseUrl
        & $VenvAlembic upgrade $AlembicTarget
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "alembic upgrade exited with code $LASTEXITCODE"
        }

        Write-Log "Migration completed. Current DB revision:"
        & $VenvAlembic current
    } finally {
        Pop-Location
        Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    }
} finally {
    # ── Stop proxy ────────────────────────────────────────────────────────────
    if ($ProxyProc -and -not $ProxyProc.HasExited) {
        Write-Log "Stopping Cloud SQL Proxy (PID $($ProxyProc.Id))"
        Stop-Process -Id $ProxyProc.Id -Force -ErrorAction SilentlyContinue
    }
}

Write-Log "Done."
