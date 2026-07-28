#!/usr/bin/env bash
set -euo pipefail

# Invoked by a Forge Scheduled Job (see deploy/README.md → "Forge Scheduled
# Jobs"). The cron route it hits has existed for months with nothing calling
# it in production (issue #93) — templates Meta approved sat `pending`
# forever, silently blocking campaigns. This script is the trigger; keep it
# under version control so the wiring is reviewable, not a one-off pasted
# into the Forge UI.

# Site root is two levels above this script (scripts/cron/*.sh), resolved
# from the script's own path so the Forge job command needs no hardcoded
# cwd and keeps working if the site is renamed/relocated.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${SITE_DIR}/.env"

# Exact-key grep, never `source` — .env values are unquoted and may contain
# spaces (see .env.example), which `source`/`export $(...)` would mis-split
# or execute as shell. A crontab/daemon may already export these; prefer
# whatever is already in the environment before falling back to the file.
read_env_var() {
  local key="$1"
  if [ -n "${!key:-}" ]; then
    printf '%s' "${!key}"
    return 0
  fi
  # `|| true`: a key absent from .env makes grep exit 1, which under `set -e`
  # would kill the script inside the `$(...)` assignment below — exiting 1
  # with NO diagnostic, the exact silent failure this script exists to avoid.
  # Swallow it here so the explicit empty-value check reports what is missing.
  # Strip one layer of surrounding quotes: `.env` files in the wild carry
  # both CRON_SECRET=abc and CRON_SECRET="abc", and a literal quote inside
  # the Bearer token yields a 401 that looks like a wrong secret.
  if [ -f "$ENV_FILE" ]; then
    grep -m1 "^${key}=" "$ENV_FILE" | cut -d '=' -f2- |
      sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/" || true
  fi
}

CRON_SECRET="$(read_env_var CRON_SECRET)"
APP_URL="$(read_env_var APP_URL)"

# Fail loud on stderr: a scheduled job that silently no-ops (empty secret,
# empty URL) looks identical to "nothing due yet" in the Forge scheduler log
# — this repo has been burned by exactly that failure class before
# (deploy.sh restart step, issue #56/#83: quiet skips masquerading as success).
if [ -z "$CRON_SECRET" ] || [ -z "$APP_URL" ]; then
  echo "sync-templates.sh: missing CRON_SECRET or APP_URL (checked env, then ${ENV_FILE})" >&2
  exit 1
fi

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) sync-templates: requesting ${APP_URL}/api/cron/sync-templates"

# `-f` is load-bearing: without it, curl exits 0 on a 4xx/5xx response body
# and the Forge scheduler log shows a green "success" for a request that
# actually failed server-side — the same silently-green failure mode as
# deploy.sh's pre-#56 restart step. `-f` makes any non-2xx a non-zero exit
# so Forge marks the job FAILED and it's visible.
response="$(curl -fsS --max-time 300 -H "Authorization: Bearer ${CRON_SECRET}" "${APP_URL}/api/cron/sync-templates")"

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) sync-templates: ${response}"
