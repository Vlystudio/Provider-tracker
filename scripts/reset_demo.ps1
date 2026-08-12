$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$databasePath = Join-Path $projectRoot 'db.sqlite3'
$resolvedParent = (Resolve-Path (Split-Path $databasePath -Parent)).Path

if ($resolvedParent -ne $projectRoot) {
    throw 'Refusing to reset a database outside the project directory.'
}
if (Test-Path -LiteralPath $databasePath) {
    Remove-Item -LiteralPath $databasePath
}

$venvPython = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPython)) {
    throw 'The demo environment is not set up. Run .\scripts\setup_demo.ps1 first.'
}
& $venvPython (Join-Path $projectRoot 'manage.py') migrate
& $venvPython (Join-Path $projectRoot 'manage.py') seed_demo
Write-Host 'The local demo database was reset with fictional data.' -ForegroundColor Green
