#!/bin/sh
# BOOK-014 W4 AC-3 walk: `next dev -p 3110` (slot 11) against the ISOLATED local Supabase only, every external
# key a dummy (STRIPE_* overridden so the .env.local key is never used), WhatsApp faked by BOOK-013's
# fake-kapso.cjs, Stripe faked by fake-stripe.cjs. $1 = locale (zh-HK | en), $2 = env file (supabase status -o env).
set -eu
OUT=$(cd "$(dirname "$0")" && pwd)
set -a; . "$2"; set +a
export NEXT_PUBLIC_SUPABASE_URL="$API_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
export KAPSO_API_KEY=walk-fake KAPSO_WEBHOOK_SECRET=walk-fake GEMINI_API_KEY=walk-fake
export GCP_PROJECT_ID=walk-fake GCP_QUEUE_NAME=walk-fake FLOWFORGE_API_TOKEN=walk-fake FLOWFORGE_API_URL=http://127.0.0.1:9
export LAYOUT_SERVICE_URL=http://127.0.0.1:9 LAYOUT_SERVICE_API_KEY=walk-fake
export STRIPE_SECRET_KEY="sk_test_$(printf walkfake%010d 0)" STRIPE_WEBHOOK_SECRET="whsec_$(printf walkfake)" STRIPE_MODE=test
export NEXT_PUBLIC_APP_URL=http://localhost:3110 APP_URL=http://localhost:3110 NEXT_PUBLIC_DEFAULT_LOCALE="$1"
export KAPSO_FAKE_LOG="$OUT/kapso-fake.jsonl" FAKE_STRIPE_LOG="$OUT/stripe-fake.jsonl" FAKE_STRIPE_FAIL_FLAG="$OUT/.fail-refunds"
export NODE_OPTIONS="--require $OUT/fakes.cjs"
cd /Users/xavierau/Code/js/whatsapp-crm--book-014-w4
exec npx next dev -p 3110
