#!/bin/sh
# BOOK-014 W6b walk: `next dev -p 3080` (slot 8) in the book-014-core tree against the ISOLATED local
# Supabase only, a walk-only Redis (127.0.0.1:56380), WhatsApp/Kapso faked by BOOK-013's fake-kapso.cjs
# (every outbound message appended to kapso-fake.jsonl). Stripe is REAL test mode: STRIPE_SECRET_KEY
# (rk_test_), STRIPE_MODE and STRIPE_WEBHOOK_SECRET come from the tree's gitignored .env.local and are
# never exported or printed here. GEMINI_API_KEY also stays the .env.local value (W8).
# $1 = env file (supabase status -o env), $2 = the tree.
set -eu
OUT=$(cd "$(dirname "$0")" && pwd)
set -a; . "$1"; set +a
export NEXT_PUBLIC_SUPABASE_URL="$API_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
export KAPSO_API_KEY=walk-fake KAPSO_WEBHOOK_SECRET=walk-kapso-secret
export GCP_PROJECT_ID=walk-fake GCP_QUEUE_NAME=walk-fake FLOWFORGE_API_TOKEN=walk-fake FLOWFORGE_API_URL=http://127.0.0.1:9
export LAYOUT_SERVICE_URL=http://127.0.0.1:9 LAYOUT_SERVICE_API_KEY=walk-fake RESEND_API_KEY= SLACK_WEBHOOK_URL_PLATFORM= SLACK_WEBHOOK_URL_CS=
export REDIS_URL=redis://127.0.0.1:56380 CRON_SECRET=walk-cron-secret DEMO_RESTAURANT_ID=
export NEXT_PUBLIC_APP_URL=http://localhost:3080 APP_URL=http://localhost:3080 NEXT_PUBLIC_DEFAULT_LOCALE="${WALK_LOCALE:-zh-HK}"
export KAPSO_FAKE_LOG="$OUT/kapso-fake.jsonl"
export NODE_OPTIONS="--require $OUT/../2026-11-27-book-013-phone-optional/fake-kapso.cjs"
cd "$2"
exec npx next dev -p 3080
