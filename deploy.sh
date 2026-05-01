#!/usr/bin/env bash
set -euo pipefail

echo "→ Installing dependencies"
npm ci

echo "→ Applying pending migrations"
npx supabase db push --linked --include-all

echo "→ Seeding platform admin (idempotent)"
npx tsx scripts/seed-platform-admin.ts

echo "→ Building Next.js"
npm run build

echo "→ Reloading daemons"
restart_daemon() {
  local name="$1"
  if sudo -n /usr/bin/supervisorctl status "$name:*" >/dev/null 2>&1; then
    sudo -n /usr/bin/supervisorctl restart "$name:*"
  else
    echo "  (daemon $name not found — skipping; create it in Forge UI for first deploy)"
  fi
}

restart_daemon ohmyclient-app
restart_daemon ohmyclient-worker

echo "✓ Deploy complete"
