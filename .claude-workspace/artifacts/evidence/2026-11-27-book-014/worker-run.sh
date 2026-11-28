#!/bin/sh
# BOOK-014 W6b walk: the BullMQ workers (scripts/start-worker.ts, as prod runs it) with the same walk env as
# dev-run.sh. Node's --env-file loads the tree's .env.local for anything not exported here (Stripe key and
# mode, webhook secret, GEMINI_API_KEY); exported walk values win. Nothing is printed.
# $1 = env file (supabase status -o env), $2 = the tree.
set -eu
OUT=$(cd "$(dirname "$0")" && pwd)
set -a; . "$1"; set +a
export NEXT_PUBLIC_SUPABASE_URL="$API_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
export KAPSO_API_KEY=walk-fake KAPSO_WEBHOOK_SECRET=walk-kapso-secret
export GCP_PROJECT_ID=walk-fake GCP_QUEUE_NAME=walk-fake FLOWFORGE_API_TOKEN=walk-fake FLOWFORGE_API_URL=http://127.0.0.1:9
export LAYOUT_SERVICE_URL=http://127.0.0.1:9 LAYOUT_SERVICE_API_KEY=walk-fake RESEND_API_KEY= SLACK_WEBHOOK_URL_PLATFORM= SLACK_WEBHOOK_URL_CS=
export REDIS_URL=redis://127.0.0.1:56380 CRON_SECRET=walk-cron-secret DEMO_RESTAURANT_ID=
export NEXT_PUBLIC_APP_URL=http://localhost:3080 APP_URL=http://localhost:3080
export KAPSO_FAKE_LOG="$OUT/kapso-fake.jsonl"
cd "$2"
exec node --env-file=.env.local --require "$OUT/../2026-11-27-book-013-phone-optional/fake-kapso.cjs" --import tsx scripts/start-worker.ts
