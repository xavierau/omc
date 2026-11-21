#!/bin/sh
# BOOK-010: a throwaway Postgres with every migration applied (memory:
# validate migrations on a scratch DB). Never DEV or prod Supabase.
#   scripts/book-010/scratch-db.sh up    -> prints BOOK010_PG_URL=...
#   scripts/book-010/scratch-db.sh rest  -> PostgREST on 127.0.0.1:55493 over it (JWT secret below)
#   scripts/book-010/scratch-db.sh down
# Then: BOOK010_PG_URL=... npx vitest run src/infrastructure/supabase/__tests__/booking-room-race.pg.test.ts
set -eu
NAME=book010-scratch-pg
PORT=${BOOK010_PG_PORT:-55492}
IMAGE=public.ecr.aws/supabase/postgres:17.6.1.143
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
URL="postgresql://postgres:postgres@127.0.0.1:$PORT/postgres"

REST=book010-scratch-rest
# A throwaway secret for the scratch PostgREST only (no real project uses it).
JWT_SECRET=book010-scratch-postgrest-jwt-secret-000000

if [ "${1:-up}" = "down" ]; then
  docker rm -f "$NAME" "$REST" >/dev/null 2>&1 || true
  echo "removed $NAME $REST"
  exit 0
fi

if [ "${1:-up}" = "rest" ]; then
  docker rm -f "$REST" >/dev/null 2>&1 || true
  docker run -d --name "$REST" -p 127.0.0.1:55493:3000 \
    -e PGRST_DB_URI="postgres://postgres:postgres@host.docker.internal:$PORT/postgres" \
    -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$JWT_SECRET" \
    -e PGRST_DB_MAX_ROWS=1000 public.ecr.aws/supabase/postgrest:v14.14 >/dev/null
  i=0
  until curl -s -o /dev/null http://127.0.0.1:55493/; do
    i=$((i + 1)); [ "$i" -gt 30 ] && { echo "postgrest did not start" >&2; exit 1; }
    sleep 1
  done
  echo "BOOK010_POSTGREST_URL=http://127.0.0.1:55493 BOOK010_POSTGREST_JWT_SECRET=$JWT_SECRET"
  exit 0
fi

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=postgres -p "127.0.0.1:$PORT:5432" "$IMAGE" >/dev/null
i=0
until psql "$URL" -qtAc 'select 1' >/dev/null 2>&1; do
  i=$((i + 1)); [ "$i" -gt 60 ] && { echo "postgres did not start" >&2; exit 1; }
  sleep 1
done
# The image's init scripts restart the server once; wait for the second start too.
sleep 3
until psql "$URL" -qtAc "select 1 from pg_roles where rolname = 'service_role'" 2>/dev/null | grep -q 1; do sleep 1; done

# Storage stubs some migrations reference (the CLI stack provides them), as the image's superuser.
ADMIN_URL="postgresql://supabase_admin:postgres@127.0.0.1:$PORT/postgres"
psql "$ADMIN_URL" -q -v ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now(), owner uuid);
CREATE TABLE IF NOT EXISTS storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb, created_at timestamptz default now());
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO postgres;
GRANT ALL ON ALL TABLES IN SCHEMA storage TO postgres;
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array(name, '/') $$;
SQL

for f in "$ROOT"/supabase/migrations/*.sql; do
  psql "$URL" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null || { echo "FAILED: $f" >&2; exit 1; }
done
echo "applied $(ls "$ROOT"/supabase/migrations/*.sql | wc -l | tr -d ' ') migrations"
echo "BOOK010_PG_URL=$URL"
