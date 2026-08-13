#!/usr/bin/env sh
set -eu

MODE="${1:-external}"

if [ "$MODE" = "external" ]; then
  if [ ! -f .env.production ]; then
    echo "Create .env.production from .env.production.example and have IT supply the production values." >&2
    exit 1
  fi
  docker compose --env-file .env.production -f docker-compose.external-db.yml config --quiet
  docker compose --env-file .env.production -f docker-compose.external-db.yml build
  docker compose --env-file .env.production -f docker-compose.external-db.yml run --rm web python manage.py check --deploy --fail-level WARNING
  docker compose --env-file .env.production -f docker-compose.external-db.yml run --rm web python manage.py migrate
  docker compose --env-file .env.production -f docker-compose.external-db.yml up -d
  docker compose --env-file .env.production -f docker-compose.external-db.yml ps
  exit 0
fi

if [ "$MODE" = "bundled" ]; then
  if [ ! -f .env.production ]; then
    echo "Create .env.production from .env.production.example and replace its production placeholders." >&2
    exit 1
  fi
  docker compose --env-file .env.production config --quiet
  docker compose --env-file .env.production run --rm web python manage.py check --deploy --fail-level WARNING
  docker compose --env-file .env.production up --build -d
  docker compose --env-file .env.production ps
  exit 0
fi

echo "Usage: ./scripts/deploy.sh [external|bundled]" >&2
exit 1
