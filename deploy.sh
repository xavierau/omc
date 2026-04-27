#!/usr/bin/env bash
set -euo pipefail

echo "→ Installing dependencies"
npm ci

echo "→ Applying pending migrations"
supabase db push --linked --include-all

echo "→ Seeding platform admin (idempotent)"
npx tsx scripts/seed-platform-admin.ts

echo "→ Building Next.js"
npm run build

echo "→ Reloading daemons"
sudo -n /usr/bin/supervisorctl restart ohmyclient-app:* || true
sudo -n /usr/bin/supervisorctl restart ohmyclient-worker:* || true

echo "✓ Deploy complete"
