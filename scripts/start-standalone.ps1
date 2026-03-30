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

function Test-UnresolvedOpenClawToken {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return $false }
    $trimmed = $Value.Trim()
    return (
        $trimmed -match '^\$\{[A-Za-z_][A-Za-z0-9_]*\}$' -or
        $trimmed -match '^\$[A-Za-z_][A-Za-z0-9_]*$' -or
        $trimmed -match '^%[A-Za-z_][A-Za-z0-9_]*%$'
    )
}

if (Test-UnresolvedOpenClawToken $env:OPENCLAW_STATE_DIR) {
    Remove-Item Env:OPENCLAW_STATE_DIR -ErrorAction SilentlyContinue
}
if (Test-UnresolvedOpenClawToken $env:OPENCLAW_CONFIG_PATH) {
    Remove-Item Env:OPENCLAW_CONFIG_PATH -ErrorAction SilentlyContinue
}
if (Test-UnresolvedOpenClawToken $env:OPENCLAW_HOME) {
    Remove-Item Env:OPENCLAW_HOME -ErrorAction SilentlyContinue
}

# Normalize OpenClaw env wiring so runtime and CLI share the same active profile.
$resolvedStateDir = $env:OPENCLAW_STATE_DIR
if ([string]::IsNullOrWhiteSpace($resolvedStateDir)) {
    if (-not [string]::IsNullOrWhiteSpace($env:OPENCLAW_CONFIG_PATH)) {
        $resolvedStateDir = Split-Path -Parent $env:OPENCLAW_CONFIG_PATH
    } elseif (-not [string]::IsNullOrWhiteSpace($env:OPENCLAW_HOME)) {
        $normalizedHome = [System.IO.Path]::GetFullPath($env:OPENCLAW_HOME)
        if ((Split-Path -Leaf $normalizedHome).ToLowerInvariant() -eq ".openclaw") {
            $resolvedStateDir = $normalizedHome
            $env:OPENCLAW_HOME = Split-Path -Parent $normalizedHome
        } else {
            $resolvedStateDir = Join-Path $normalizedHome ".openclaw"
            $env:OPENCLAW_HOME = $normalizedHome
        }
    } else {
        $env:OPENCLAW_HOME = $env:USERPROFILE
        $resolvedStateDir = Join-Path $env:USERPROFILE ".openclaw"
    }
}
$env:OPENCLAW_STATE_DIR = $resolvedStateDir
if ([string]::IsNullOrWhiteSpace($env:OPENCLAW_CONFIG_PATH)) {
    $env:OPENCLAW_CONFIG_PATH = Join-Path $resolvedStateDir "openclaw.json"
}
if ([string]::IsNullOrWhiteSpace($env:OPENCLAW_HOME)) {
    $env:OPENCLAW_HOME = Split-Path -Parent $resolvedStateDir
}

Write-Host "Starting Clawstrap Control Surface..." -ForegroundColor Cyan
Write-Host "  URL:      http://localhost:$($env:PORT)" -ForegroundColor Cyan
Write-Host "  NODE_ENV: $($env:NODE_ENV)" -ForegroundColor Cyan
Write-Host "  HOSTNAME: $($env:HOSTNAME)" -ForegroundColor Cyan

# Start the standalone server
Set-Location $StandaloneDir
& node server.js
