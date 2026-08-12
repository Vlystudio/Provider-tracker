$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$venvPython = Join-Path $projectRoot '.venv\Scripts\python.exe'

if (-not (Test-Path -LiteralPath $venvPython)) {
    throw 'The demo environment is not set up. Run .\scripts\setup_demo.ps1 first.'
}

$env:DJANGO_DEBUG = 'true'
$env:DEMO_MODE = 'true'
$env:CELERY_TASK_ALWAYS_EAGER = 'true'
Write-Host 'Provider Tracker: http://127.0.0.1:8000' -ForegroundColor Cyan
Write-Host 'Demo accounts use password: DemoOnly!2026'
& $venvPython (Join-Path $projectRoot 'manage.py') runserver 127.0.0.1:8000
