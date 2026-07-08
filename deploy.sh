#!/usr/bin/env bash
set -euo pipefail

echo "→ Installing dependencies"
npm ci

echo "→ Applying pending migrations"
npx supabase db push --linked --include-all

echo "→ Seeding platform admin (idempotent)"
./node_modules/.bin/tsx scripts/seed-platform-admin.ts

echo "→ Building Next.js"
npm run build

echo "→ Restarting daemons"
# The app + worker run under Forge/supervisor with AUTO-GENERATED numeric program
# names (daemon-NNNNNN) that change if a daemon is recreated — so we resolve the
# program by matching its configured command, falling back to the last-known
# name. Two hard rules (issue #56, prod login outage): a build that does not
# restart the app is a FAILED deploy, so (1) a program we can't find is fatal,
# not a silent skip, and (2) we confirm each daemon actually came back up before
# declaring success. The command patterns below match the daemons documented in
# deploy/README.md — the app runs `node .next/standalone/server.js` (output:
# 'standalone'), the worker runs `npx tsx scripts/start-worker.ts`.

# Resolve a live supervisor group name. Prefer a command match across the Forge
# program configs (robust to renumbering — Forge names the conf file after the
# daemon group), then the last-known name; empty if neither is a live program.
resolve_daemon() {
  local cmd_pattern="$1" fallback="$2" conf name
  conf=$(sudo -n grep -rlE "command=.*(${cmd_pattern})" /etc/supervisor/conf.d/ 2>/dev/null | head -n1 || true)
  if [ -n "$conf" ]; then
    name=$(basename "$conf" .conf)
  else
    name="$fallback"
  fi
  if sudo -n /usr/bin/supervisorctl status "${name}:*" >/dev/null 2>&1; then
    printf '%s' "$name"
  fi
}

# Restart a daemon and confirm it came back up. Verifying via supervisor state
# (rather than an HTTP probe) is deliberate: it makes no assumption about the
# app's port or whether Node vs nginx serves /_next/static — a program that
# reaches RUNNING after the restart is serving the freshly built .next.
restart_daemon() {
  local label="$1" cmd_pattern="$2" fallback="$3" name status
  name=$(resolve_daemon "$cmd_pattern" "$fallback")
  if [ -z "$name" ]; then
    echo "  ✗ No live supervisor program for the ${label} (command /${cmd_pattern}/, fallback ${fallback})." >&2
    echo "    A build without a restart is a failed deploy — aborting." >&2
    exit 1
  fi
  echo "  restarting ${label} → ${name}"
  sudo -n /usr/bin/supervisorctl restart "${name}:*"
  for _ in $(seq 1 15); do
    status=$(sudo -n /usr/bin/supervisorctl status "${name}:*" 2>/dev/null || true)
    if printf '%s' "$status" | grep -qE 'FATAL|BACKOFF|EXITED'; then
      echo "  ✗ ${label} (${name}) did not come back up: ${status}" >&2
      exit 1
    fi
    if printf '%s' "$status" | grep -q 'RUNNING'; then
      echo "  ${label} is RUNNING"
      return 0
    fi
    sleep 2
  done
  echo "  ✗ ${label} (${name}) did not reach RUNNING after restart: ${status}" >&2
  exit 1
}

restart_daemon "app"    "standalone/server\.js|npm start|next start" "daemon-746791"
restart_daemon "worker" "start-worker"                               "daemon-801730"

echo "✓ Deploy complete"
