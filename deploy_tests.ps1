# Windows PowerShell Script to build, generate, and deploy benchmarks
param (
    [string]$Filter = ""
)

$ErrorActionPreference = "Stop"

$JS_ROOT = "$PSScriptRoot"
$AppData = $env:APPDATA
$TargetDir = "$AppData\godot\app_userdata\Turing Complete\schematics\component_factory\test_output"

Write-Host "1. Building project..." -ForegroundColor Cyan
Set-Location $JS_ROOT
npm run build
if ($LASTEXITCODE -ne 0) { throw "Build failed" }

Write-Host "2. Generating benchmarks (Filter: '$Filter')..." -ForegroundColor Cyan
node dist/scripts/generate_benchmarks.js $Filter
if ($LASTEXITCODE -ne 0) { throw "Benchmark generation failed" }

Write-Host "3. Deploying to Tuning Complete ($TargetDir)..." -ForegroundColor Cyan
if ([string]::IsNullOrEmpty($Filter)) {
    if (Test-Path "$TargetDir") {
       Remove-Item "$TargetDir" -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path "$TargetDir" | Out-Null
} else {
    if (-not (Test-Path "$TargetDir")) {
        New-Item -ItemType Directory -Force -Path "$TargetDir" | Out-Null
    }
}

Copy-Item -Path "test_output\*" -Destination "$TargetDir" -Recurse -Force

Write-Host "Done! Check the game schematics." -ForegroundColor Green
