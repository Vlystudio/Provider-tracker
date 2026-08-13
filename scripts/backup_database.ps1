param(
    [Parameter(Mandatory = $true)]
    [string]$OutputFile
)

$ErrorActionPreference = 'Stop'
if (-not $env:POSTGRES_HOST -or -not $env:POSTGRES_DB -or -not $env:POSTGRES_USER) {
    throw 'Set POSTGRES_HOST, POSTGRES_DB, POSTGRES_USER, and PGPASSWORD in the current secure session.'
}

$resolvedOutput = [IO.Path]::GetFullPath($OutputFile)
$parent = Split-Path -Parent $resolvedOutput
if (-not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent | Out-Null
}

$postgresPort = if ($env:POSTGRES_PORT) { $env:POSTGRES_PORT } else { '5432' }
pg_dump --host $env:POSTGRES_HOST --port $postgresPort --username $env:POSTGRES_USER --dbname $env:POSTGRES_DB --format custom --file $resolvedOutput
Write-Host "Backup written to $resolvedOutput" -ForegroundColor Green
