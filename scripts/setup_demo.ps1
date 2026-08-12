$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$venvPython = Join-Path $projectRoot '.venv\Scripts\python.exe'

if (-not (Test-Path -LiteralPath $venvPython)) {
    python -m venv (Join-Path $projectRoot '.venv')
}

& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -r (Join-Path $projectRoot 'requirements.txt')
& $venvPython (Join-Path $projectRoot 'manage.py') migrate
& $venvPython (Join-Path $projectRoot 'manage.py') seed_demo

Write-Host ''
Write-Host 'Provider Tracker demo setup is complete.' -ForegroundColor Green
Write-Host 'Run: .\scripts\run_demo.ps1'
Write-Host 'URL: http://127.0.0.1:8000'
Write-Host 'Accounts: ura.demo, admin.demo, viewer.demo, auditor.demo'
Write-Host 'Password: DemoOnly!2026'
