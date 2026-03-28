# Clawstrap Control Surface — Service Uninstaller
# Stops and removes the ClawstrapSurface Windows service.
# Must be run as Administrator.

$ErrorActionPreference = "Stop"

$ServiceName = "ClawstrapSurface"

# --- 1. Check Administrator privileges ---
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "ERROR: This script must be run as Administrator." -ForegroundColor Red
    Write-Host "Right-click PowerShell and select 'Run as administrator', then try again." -ForegroundColor Yellow
    exit 1
}

# --- 2. Check if NSSM is available ---
$nssm = Get-Command nssm -ErrorAction SilentlyContinue
if (-not $nssm) {
    Write-Host "ERROR: NSSM not found. Cannot remove the service." -ForegroundColor Red
    exit 1
}

# --- 3. Check if service exists ---
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
    Write-Host "Service '$ServiceName' does not exist. Nothing to remove." -ForegroundColor Yellow
    exit 0
}

# --- 4. Stop the service if running ---
if ($svc.Status -eq "Running") {
    Write-Host "Stopping service '$ServiceName'..." -ForegroundColor Yellow
    & nssm stop $ServiceName
    Start-Sleep -Seconds 2
    Write-Host "Service stopped." -ForegroundColor Green
}

# --- 5. Remove the service ---
Write-Host "Removing service '$ServiceName'..." -ForegroundColor Yellow
& nssm remove $ServiceName confirm

# --- 6. Confirm removal ---
Start-Sleep -Seconds 1
$check = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($check) {
    Write-Host "WARNING: Service may still be registered. A reboot might be required." -ForegroundColor Yellow
} else {
    Write-Host "Service '$ServiceName' removed successfully." -ForegroundColor Green
}
