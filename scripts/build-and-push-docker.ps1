<#
.SYNOPSIS
  Build the Agora frontend, copy the bundle into the backend, build the
  combined Docker image, and push it to Docker Hub.

.EXAMPLE
  # No env vars required — defaults are baked in:
  ./scripts/build-and-push-docker.ps1

.EXAMPLE
  # Override defaults via env vars:
  $env:DOCKER_USERNAME = "myuser"
  $env:IMAGE_NAME      = "agora"
  $env:IMAGE_TAG       = "v1"
  ./scripts/build-and-push-docker.ps1

.NOTES
  PostgreSQL is NOT installed in the image. Provide DATABASE_URL at run time.
  Requires: node + npm (or pnpm/yarn), docker (logged in for push).
#>

[CmdletBinding()]
param(
    [string]$DockerUsername = $(if ($env:DOCKER_USERNAME) { $env:DOCKER_USERNAME } else { "asaddev13" }),
    [string]$ImageName      = $(if ($env:IMAGE_NAME)       { $env:IMAGE_NAME }       else { "agora-server" }),
    [string]$ImageTag       = $(if ($env:IMAGE_TAG)        { $env:IMAGE_TAG }        else { "v1" }),
    [string]$Platform       = $env:PLATFORM,
    [int]   $Push           = $(if ($env:PUSH -ne $null -and $env:PUSH -ne "") { [int]$env:PUSH } else { 1 })
)

$ErrorActionPreference = "Stop"

function Write-Log  ([string]$msg) { Write-Host "[build] $msg" -ForegroundColor Cyan }
function Write-Fail ([string]$msg) { Write-Host "[error] $msg" -ForegroundColor Red; exit 1 }

if (-not $DockerUsername) {
    Write-Fail "DOCKER_USERNAME is required (your Docker Hub user/org)."
}

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ClientDir = Join-Path $RepoRoot "client"
$ServerDir = Join-Path $RepoRoot "server"
$StaticDir = Join-Path $ServerDir "static"
$DistDir = Join-Path $ClientDir "dist"
$DockerImage = "docker.io/$DockerUsername/${ImageName}:${ImageTag}"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Write-Fail "docker CLI not found in PATH" }
if (-not (Test-Path $ClientDir)) { Write-Fail "client/ directory not found at $ClientDir" }
if (-not (Test-Path $ServerDir)) { Write-Fail "server/ directory not found at $ServerDir" }

# ── Detect package manager ──────────────────────────────────────────────────
$pkgManager =
if (Test-Path (Join-Path $ClientDir "pnpm-lock.yaml")) { "pnpm" }
elseif (Test-Path (Join-Path $ClientDir "yarn.lock")) { "yarn" }
else { "npm" }
Write-Log "Frontend package manager: $pkgManager"

# ── Resolve real package-manager executable ────────────────────────────────
# On Windows, `npm` / `pnpm` / `yarn` are PowerShell wrapper scripts that
# mangle the first argument (you'll see "Unknown command: 'pm'" instead of
# "ci"). Resolve to the .cmd / .exe shim and invoke that directly.
function Resolve-PackageManager([string]$name) {
    $candidates =
        if ($IsWindows -or $env:OS -eq "Windows_NT") {
            @("$name.cmd", "$name.exe", $name)
        } else {
            @($name)
        }
    foreach ($c in $candidates) {
        $cmd = Get-Command $c -ErrorAction SilentlyContinue |
               Where-Object { $_.CommandType -ne 'Function' -and $_.CommandType -ne 'Alias' } |
               Select-Object -First 1
        if ($cmd) { return $cmd.Source }
    }
    Write-Fail "$name not found in PATH"
}
$PkgExe = Resolve-PackageManager $pkgManager
Write-Log "Using package manager binary: $PkgExe"

# ── Build frontend ──────────────────────────────────────────────────────────
# Clean stale build artefacts first so no old localhost:8000 bundles survive.
Write-Log "Cleaning stale frontend build"
if (Test-Path $DistDir) { Remove-Item -Recurse -Force $DistDir }

Push-Location $ClientDir
try {
    Write-Log "Installing frontend dependencies"
    switch ($pkgManager) {
        "pnpm" {
            & $PkgExe install --frozen-lockfile
            if ($LASTEXITCODE -ne 0) { & $PkgExe install }
        }
        "yarn" {
            & $PkgExe install --frozen-lockfile
            if ($LASTEXITCODE -ne 0) { & $PkgExe install }
        }
        "npm" {
            # `npm ci` deletes all of node_modules first, which hits EPERM on
            # Windows when native .node binaries are locked by VS Code / AV.
            # `npm install` updates only what changed and avoids that issue.
            & $PkgExe install
        }
    }
    if ($LASTEXITCODE -ne 0) { Write-Fail "Frontend dependency install failed" }

    if ($null -eq $env:VITE_API_BASE_URL) { $env:VITE_API_BASE_URL = "" }
    if ($null -eq $env:VITE_WS_BASE_URL)  { $env:VITE_WS_BASE_URL  = "" }
    Write-Log "Building frontend production bundle (VITE_API_BASE_URL='$($env:VITE_API_BASE_URL)')"
    switch ($pkgManager) {
        "pnpm" { & $PkgExe build }
        "yarn" { & $PkgExe build }
        "npm"  { & $PkgExe run build }
    }
    if ($LASTEXITCODE -ne 0) { Write-Fail "Frontend build failed" }
}
finally {
    Pop-Location
}

if (-not (Test-Path $DistDir)) { Write-Fail "Frontend build output not found at $DistDir" }
if (-not (Test-Path (Join-Path $DistDir "index.html"))) { Write-Fail "Frontend build missing index.html" }

# Verify no localhost:8000 leaked into the built JS/CSS bundles.
# (Restrict to .js/.css/.html — binary font files can produce false positives.)
Write-Log "Verifying production bundle contains no localhost:8000 references"
$AssetsDir = Join-Path $DistDir "assets"
if (Test-Path $AssetsDir) {
    $textFiles = Get-ChildItem -Path $AssetsDir -Recurse -File |
                 Where-Object { $_.Extension -in '.js', '.css', '.html', '.map' }
    $leakedFiles = @()
    foreach ($f in $textFiles) {
        if (Select-String -Path $f.FullName -Pattern "localhost:8000" -SimpleMatch -Quiet) {
            $leakedFiles += $f.FullName
        }
    }
    if ($leakedFiles.Count -gt 0) {
        Write-Host "[error] localhost:8000 found in:" -ForegroundColor Red
        $leakedFiles | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
        Write-Fail "localhost:8000 found in production bundle — check VITE_API_BASE_URL and VITE_WS_BASE_URL"
    }
}
Write-Log "Bundle clean — no localhost:8000 references found"

# ── Copy bundle into backend/static ─────────────────────────────────────────
Write-Log "Refreshing $StaticDir"
if (Test-Path $StaticDir) { Remove-Item -Recurse -Force $StaticDir }
New-Item -ItemType Directory -Path $StaticDir | Out-Null
Copy-Item -Recurse -Force (Join-Path $DistDir "*") $StaticDir
if (-not (Test-Path (Join-Path $StaticDir "index.html"))) { Write-Fail "Copy failed: index.html missing in $StaticDir" }
Write-Log "Frontend bundle staged at $StaticDir"

# ── Docker build (context = repo root) ──────────────────────────────────
Write-Log "Building Docker image: $DockerImage"
Push-Location $RepoRoot
try {
    if ($Platform) {
        & docker buildx build --platform $Platform -t $DockerImage -f Dockerfile --load .
    }
    else {
        & docker build -f Dockerfile -t $DockerImage .
    }
}
finally {
    Pop-Location
}
if ($LASTEXITCODE -ne 0) { Write-Fail "docker build failed" }

# ── Push ───────────────────────────────────────────────────────────────
if ($Push -eq 1) {
    Write-Log "Pushing $DockerImage to Docker Hub"
    & docker push $DockerImage
    if ($LASTEXITCODE -ne 0) { Write-Fail "docker push failed" }
    Write-Log "Pushed: $DockerImage"
}
else {
    Write-Log "PUSH=0 — skipping docker push. Built image: $DockerImage"
}

Write-Log "Done."
