# Process-env overrides for the local walk (@next/env and load-env never override a defined key).
eval "$(cd /Users/xavierau/Code/js/whatsapp-crm--agent-001 && supabase status -o env 2>/dev/null | sed 's/^/export LOCAL_/')"
export NEXT_PUBLIC_SUPABASE_URL="$LOCAL_API_URL"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$LOCAL_ANON_KEY"
export SUPABASE_SERVICE_ROLE_KEY="$LOCAL_SERVICE_ROLE_KEY"
export REDIS_URL=redis://127.0.0.1:16399
export KAPSO_API_KEY=local-capture-only
export KAPSO_WEBHOOK_SECRET=w2-local-webhook-secret
export KAPSO_CAPTURE_FILE=/private/tmp/claude-501/-Users-xavierau-Code-js-whatsapp-crm/b7ce2348-be88-463f-a29e-8e4b78a7d232/scratchpad/w2/kapso-capture.jsonl
export NODE_OPTIONS="--require /private/tmp/claude-501/-Users-xavierau-Code-js-whatsapp-crm/b7ce2348-be88-463f-a29e-8e4b78a7d232/scratchpad/w2/tools/kapso-capture.cjs"
export AGENT_MODEL=gemini-3.1-flash-lite
export PORT=3020
export APP=http://localhost:3020
export NEXT_PUBLIC_APP_URL=http://localhost:3020
export APP_URL=http://localhost:3020
export FLOWFORGE_API_URL=http://127.0.0.1:9
export LAYOUT_SERVICE_URL=http://127.0.0.1:9
export NEXT_PUBLIC_DEFAULT_LOCALE=en
export ADMIN_EMAIL=w2-admin@example.test
export ADMIN_PASSWORD=w2-local-only-pass-1
export OUT=/private/tmp/claude-501/-Users-xavierau-Code-js-whatsapp-crm/b7ce2348-be88-463f-a29e-8e4b78a7d232/scratchpad/w2/shots
export NODE_PATH=/Users/xavierau/Library/pnpm/global/5/.pnpm/playwright@1.55.1/node_modules
