# RTK Setup Script for Windows
# Downloads and installs RTK (Rust Token Killer) to rtk/bin/

param(
    [string]$Version = "v0.43.0"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$binDir = Join-Path $scriptDir "bin"

Write-Host "RTK Setup - Installing Rust Token Killer" -ForegroundColor Cyan
Write-Host "Version: $Version" -ForegroundColor Gray

# Create bin directory if not exists
if (-not (Test-Path $binDir)) {
    New-Item -ItemType Directory -Path $binDir -Force | Out-Null
    Write-Host "✓ Created $binDir" -ForegroundColor Green
}

# Download binary
$url = "https://github.com/rtk-ai/rtk/releases/download/$Version/rtk-x86_64-pc-windows-msvc.zip"
$zipPath = Join-Path $scriptDir "rtk-$Version.zip"

Write-Host "⏳ Downloading from $url..." -ForegroundColor Yellow

try {
    Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing -ErrorAction Stop
    Write-Host "✓ Download complete" -ForegroundColor Green
} catch {
    Write-Host "✗ Download failed: $_" -ForegroundColor Red
    exit 1
}

# Extract
Write-Host "📦 Extracting..." -ForegroundColor Yellow
try {
    Expand-Archive -Path $zipPath -DestinationPath $binDir -Force -ErrorAction Stop
    Write-Host "✓ Extracted to $binDir" -ForegroundColor Green
} catch {
    Write-Host "✗ Extraction failed: $_" -ForegroundColor Red
    exit 1
}

# Verify
$exePath = Join-Path $binDir "rtk.exe"
if (Test-Path $exePath) {
    $version = & $exePath --version
    Write-Host "✓ RTK installed successfully: $version" -ForegroundColor Green

    # Cleanup zip
    Remove-Item $zipPath -Force
    Write-Host "✓ Cleaned up download file" -ForegroundColor Green
} else {
    Write-Host "✗ RTK binary not found at $exePath" -ForegroundColor Red
    exit 1
}

Write-Host "`nRTK is ready! Next step: restart Claude Code to activate the hook." -ForegroundColor Cyan
