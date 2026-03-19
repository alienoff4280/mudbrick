# Mudbrick v2 -- Build Python Sidecar (Windows)
#
# Packages the FastAPI backend into a standalone executable using PyInstaller.
# Output is placed at src-tauri/binaries/mudbrick-api-x86_64-pc-windows-msvc.exe
# which Tauri expects for the sidecar.
#
# Prerequisites:
#   pip install pyinstaller
#   pip install -r apps/api/requirements.txt
#
# Usage: powershell scripts/build-sidecar.ps1

param(
    [string]$OutputDir = "src-tauri/binaries"
)

$ErrorActionPreference = "Stop"

Write-Host "Building Mudbrick API sidecar for Windows..." -ForegroundColor Cyan

# Ensure output directory exists
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

# Build with PyInstaller
$apiDir = "apps/api"
$entryPoint = "$apiDir/app/main.py"
$binaryName = "mudbrick-api-x86_64-pc-windows-msvc"

Write-Host "Running PyInstaller..." -ForegroundColor Yellow
python -m PyInstaller `
    --onefile `
    --name $binaryName `
    --distpath $OutputDir `
    --workpath "build/pyinstaller" `
    --specpath "build/pyinstaller" `
    --noconfirm `
    --clean `
    --add-data "$apiDir/app;app" `
    $entryPoint

if ($LASTEXITCODE -ne 0) {
    Write-Host "PyInstaller build failed!" -ForegroundColor Red
    exit 1
}

$outputPath = Join-Path $OutputDir "$binaryName.exe"
if (Test-Path $outputPath) {
    $size = (Get-Item $outputPath).Length / 1MB
    Write-Host "Sidecar built: $outputPath ($([math]::Round($size, 1)) MB)" -ForegroundColor Green
} else {
    Write-Host "Expected output not found: $outputPath" -ForegroundColor Red
    exit 1
}
