#!/bin/sh
# BOOK-013 decision 9: build scratch_096 from migrations 001..095 on a throwaway
# supabase/postgres container, then run the assertions ($1) with :migration =
# $2 (096, or an empty file for the red run) inside BEGIN ... ROLLBACK, then drop the DB.
set -eu
TREE=/Users/xavierau/Code/js/whatsapp-crm--book-013
DB=scratch_096
export PGPASSWORD=postgres
PORT="${PORT:-55366}"
P="rtk proxy psql -h 127.0.0.1 -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
$P -d $DB <<'SQL'
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb, created_at timestamptz DEFAULT now());
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'service_role'::text $$;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE IF NOT EXISTS storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(name, '/') $$;
DO $$ BEGIN CREATE PUBLICATION supabase_realtime; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
SQL
for f in "$TREE"/supabase/migrations/0*.sql; do
  case "$(basename "$f")" in 096_*) continue ;; esac
  $P -d $DB -f "$f" > /dev/null || { echo "FAILED at $f"; exit 1; }
done
echo "applied 001..095"
$P -d $DB -v migration="$2" -f "$1"
$P -d postgres -c "DROP DATABASE $DB"
echo "dropped $DB"
