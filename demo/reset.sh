#!/bin/sh
# `npm run demo:reset`: the demo database from scratch — migrations, «Демо-клініка» with its staff; every code issued before
# is gone with the old database. The API is stopped meanwhile. Refuses outside the stand (DEMO=1 lives only in demo/compose.yml).
set -eu
cd "$(dirname "$0")"
docker compose stop api
docker compose run --rm --no-deps api node --disable-warning=ExperimentalWarning src/demo/seed.ts
docker compose start api
echo "reset done: sign in at https://$(grep '^DEMO_DOMAIN=' .env | cut -d= -f2)/#/clinic"
