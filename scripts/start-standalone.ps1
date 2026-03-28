# Clawstrap Control Surface — Standalone Startup Script (Windows)
# Copies static assets into .next/standalone and starts the server.
# PowerShell equivalent of start-standalone.sh.

$ErrorActionPreference = "Stop"

# Resolve paths relative to this script's location
$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $PSScriptRoot) {
    # Fallback if run outside script context
    $ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}

$StandaloneDir   = Join-Path $ProjectRoot ".next\standalone"
$StandaloneNext  = Join-Path $StandaloneDir ".next"
$StandaloneStatic = Join-Path $StandaloneNext "static"
$SourceStatic    = Join-Path $ProjectRoot ".next\static"
$SourcePublic    = Join-Path $ProjectRoot "public"
$StandalonePublic = Join-Path $StandaloneDir "public"
$ServerJs        = Join-Path $StandaloneDir "server.js"

# Verify the standalone build exists
if (-not (Test-Path $ServerJs)) {
    Write-Host "ERROR: Standalone server missing at $ServerJs" -ForegroundColor Red
    Write-Host "Run 'pnpm build' first." -ForegroundColor Yellow
    exit 1
}

# Ensure .next directory exists inside standalone
if (-not (Test-Path $StandaloneNext)) {
    New-Item -ItemType Directory -Path $StandaloneNext -Force | Out-Null
}

# Copy static assets
if (Test-Path $SourceStatic) {
    if (Test-Path $StandaloneStatic) {
        Remove-Item -Recurse -Force $StandaloneStatic
    }
    Copy-Item -Recurse -Force $SourceStatic $StandaloneStatic
    Write-Host "Copied static assets to standalone directory." -ForegroundColor Green
}

# Copy public folder
if (Test-Path $SourcePublic) {
    if (Test-Path $StandalonePublic) {
        Remove-Item -Recurse -Force $StandalonePublic
    }
    Copy-Item -Recurse -Force $SourcePublic $StandalonePublic
    Write-Host "Copied public folder to standalone directory." -ForegroundColor Green
}

# Set environment variables (use existing values or defaults)
$env:PORT     = if ($env:PORT)     { $env:PORT }     else { "3000" }
$env:NODE_ENV = if ($env:NODE_ENV) { $env:NODE_ENV } else { "production" }
$env:HOSTNAME = if ($env:HOSTNAME) { $env:HOSTNAME } else { "0.0.0.0" }

Write-Host "Starting Clawstrap Control Surface..." -ForegroundColor Cyan
Write-Host "  URL:      http://localhost:$($env:PORT)" -ForegroundColor Cyan
Write-Host "  NODE_ENV: $($env:NODE_ENV)" -ForegroundColor Cyan
Write-Host "  HOSTNAME: $($env:HOSTNAME)" -ForegroundColor Cyan

# Start the standalone server
Set-Location $StandaloneDir
& node server.js
