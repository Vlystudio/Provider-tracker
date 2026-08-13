param(
    [ValidateSet('external', 'bundled')]
    [string]$Mode = 'external'
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $projectRoot

if ($Mode -eq 'external') {
    $environmentFile = Join-Path $projectRoot '.env.production'
    if (-not (Test-Path -LiteralPath $environmentFile)) {
        throw 'Create .env.production from .env.production.example and have IT supply the production values.'
    }
    docker compose --env-file .env.production -f docker-compose.external-db.yml config --quiet
    docker compose --env-file .env.production -f docker-compose.external-db.yml build
    docker compose --env-file .env.production -f docker-compose.external-db.yml run --rm web python manage.py check --deploy --fail-level WARNING
    docker compose --env-file .env.production -f docker-compose.external-db.yml run --rm web python manage.py migrate
    docker compose --env-file .env.production -f docker-compose.external-db.yml up -d
    docker compose --env-file .env.production -f docker-compose.external-db.yml ps
    exit 0
}

$environmentFile = Join-Path $projectRoot '.env.production'
if (-not (Test-Path -LiteralPath $environmentFile)) {
    throw 'Create .env.production from .env.production.example and replace its production placeholders.'
}
docker compose --env-file .env.production config --quiet
docker compose --env-file .env.production run --rm web python manage.py check --deploy --fail-level WARNING
docker compose --env-file .env.production up --build -d
docker compose --env-file .env.production ps
