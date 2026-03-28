# Clawstrap Control Surface — NSSM Service Installer
# Installs the standalone Next.js server as a Windows service using NSSM.
# Must be run as Administrator.

$ErrorActionPreference = "Stop"

$ServiceName   = "ClawstrapSurface"
$DisplayName   = "Clawstrap Control Surface"
$ProjectRoot   = Split-Path -Parent $PSScriptRoot
if (-not $PSScriptRoot) {
    $ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}

# --- 1. Check Administrator privileges ---
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "ERROR: This script must be run as Administrator." -ForegroundColor Red
    Write-Host "Right-click PowerShell and select 'Run as administrator', then try again." -ForegroundColor Yellow
    exit 1
}

# --- 2. Check NSSM availability ---
$nssm = Get-Command nssm -ErrorAction SilentlyContinue
if (-not $nssm) {
    Write-Host "ERROR: NSSM (Non-Sucking Service Manager) not found." -ForegroundColor Red
    Write-Host ""
    Write-Host "Install it with one of:" -ForegroundColor Yellow
    Write-Host "  winget install nssm"
    Write-Host "  choco install nssm"
    Write-Host "  Or download from https://nssm.cc/download"
    exit 1
}
Write-Host "NSSM found at: $($nssm.Source)" -ForegroundColor Green

# --- 3. Check Node.js availability ---
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "ERROR: node.exe not found in PATH." -ForegroundColor Red
    exit 1
}
$NodeExe = $node.Source
Write-Host "Node found at: $NodeExe" -ForegroundColor Green

# --- 4. Verify the standalone build exists ---
$ServerJs = Join-Path $ProjectRoot ".next\standalone\server.js"
if (-not (Test-Path $ServerJs)) {
    Write-Host "ERROR: Standalone server missing at $ServerJs" -ForegroundColor Red
    Write-Host "Run 'pnpm build' first." -ForegroundColor Yellow
    exit 1
}

# --- 5. Check if service already exists ---
$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host "Service '$ServiceName' already exists (status: $($existingService.Status))." -ForegroundColor Yellow
    $response = Read-Host "Reinstall? (y/N)"
    if ($response -ne "y" -and $response -ne "Y") {
        Write-Host "Aborted." -ForegroundColor Yellow
        exit 0
    }
    # Stop and remove the existing service
    Write-Host "Stopping existing service..." -ForegroundColor Yellow
    & nssm stop $ServiceName 2>$null
    Start-Sleep -Seconds 2
    & nssm remove $ServiceName confirm
    Write-Host "Removed existing service." -ForegroundColor Green
}

# --- 6. Create logs directory ---
$LogDir = Join-Path $ProjectRoot "logs"
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
    Write-Host "Created logs directory: $LogDir" -ForegroundColor Green
}

# --- 7. Install the service ---
Write-Host ""
Write-Host "Installing service '$ServiceName'..." -ForegroundColor Cyan

# Install base service: nssm install <name> <exe> <args>
& nssm install $ServiceName $NodeExe ".next\standalone\server.js"

# Configure service properties
& nssm set $ServiceName DisplayName $DisplayName
& nssm set $ServiceName Description "Next.js standalone server for the Clawstrap Control Surface dashboard."
& nssm set $ServiceName AppDirectory $ProjectRoot
& nssm set $ServiceName AppEnvironmentExtra "PORT=3000" "NODE_ENV=production" "HOSTNAME=0.0.0.0"

# Logging
$StdoutLog = Join-Path $LogDir "clawstrap.log"
$StderrLog = Join-Path $LogDir "clawstrap-err.log"
& nssm set $ServiceName AppStdout $StdoutLog
& nssm set $ServiceName AppStderr $StderrLog
& nssm set $ServiceName AppStdoutCreationDisposition 4  # Append
& nssm set $ServiceName AppStderrCreationDisposition 4  # Append
& nssm set $ServiceName AppRotateFiles 1
& nssm set $ServiceName AppRotateBytes 5242880  # 5 MB

# Start type: automatic
& nssm set $ServiceName Start SERVICE_AUTO_START

# Restart on failure with 5-second delay
& nssm set $ServiceName AppExit Default Restart
& nssm set $ServiceName AppRestartDelay 5000

Write-Host "Service installed successfully." -ForegroundColor Green

# --- 8. Start the service ---
Write-Host "Starting service..." -ForegroundColor Cyan
& nssm start $ServiceName

Start-Sleep -Seconds 2

# --- 9. Print status ---
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host " Clawstrap Control Surface is RUNNING"   -ForegroundColor Green
    Write-Host " URL: http://localhost:3000"              -ForegroundColor Green
    Write-Host " Service: $ServiceName"                   -ForegroundColor Green
    Write-Host " Logs: $LogDir"                           -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "WARNING: Service installed but may not be running yet." -ForegroundColor Yellow
    Write-Host "Check status with: nssm status $ServiceName" -ForegroundColor Yellow
    Write-Host "Check logs at: $LogDir" -ForegroundColor Yellow
}
