#!/bin/sh
# BOOK-013 decision 9 r2 walk: `next dev -p 3060` (slot 6) against the LOCAL Supabase only,
# with every external key a dummy and WhatsApp faked by fake-kapso.cjs.
# $1 = locale (zh-HK | en), $2 = env file from `supabase status -o env`.
set -eu
DIR=$(cd "$(dirname "$0")/../2026-11-27-book-013-phone-optional" && pwd); OUT=$(cd "$(dirname "$0")" && pwd)
set -a; . "$2"; set +a
export NEXT_PUBLIC_SUPABASE_URL="$API_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
export KAPSO_API_KEY=walk-fake KAPSO_WEBHOOK_SECRET=walk-fake GEMINI_API_KEY=walk-fake
export GCP_PROJECT_ID=walk-fake GCP_QUEUE_NAME=walk-fake FLOWFORGE_API_TOKEN=walk-fake FLOWFORGE_API_URL=http://127.0.0.1:9
export LAYOUT_SERVICE_URL=http://127.0.0.1:9 LAYOUT_SERVICE_API_KEY=walk-fake
export NEXT_PUBLIC_APP_URL=http://localhost:3060 APP_URL=http://localhost:3060 NEXT_PUBLIC_DEFAULT_LOCALE="$1"
export KAPSO_FAKE_LOG="$OUT/kapso-fake.jsonl" NODE_OPTIONS="--require $DIR/fake-kapso.cjs"
cd /Users/xavierau/Code/js/whatsapp-crm--book-013
exec npx next dev -p 3060
