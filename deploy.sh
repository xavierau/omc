#!/usr/bin/env bash
set -euo pipefail

# Free space required before we touch anything (issue #83). A deploy that
# refuses to start is far cheaper than one that half-succeeds: when the disk
# filled mid-`npm ci`, npm reported "added 840 packages" while writing a
# TRUNCATED supabase binary (73MB on disk, ELF header describing 96MB of
# sections). Every later invocation segfaulted, and the deploy died three
# steps further on with `Segmentation fault` and no hint of the real cause.
#
# `npm ci` needs roughly a gigabyte for node_modules plus a regrowing npm
# cache, and `next build` another ~130MB. The default is deliberately just
# above that rather than generous — this host runs eight sites on a 29GB
# volume and typically sits near 2GB free, so a larger floor would block
# deploys that do in fact succeed. Raise it via DEPLOY_MIN_FREE_MB once the
# volume grows; growing the volume is the actual fix.
DEPLOY_MIN_FREE_MB="${DEPLOY_MIN_FREE_MB:-1500}"

echo "→ Checking free disk space"
free_mb=$(df -Pm . | awk 'NR==2 {print $4}')
if [ -z "$free_mb" ]; then
  echo "  ✗ Could not determine free disk space." >&2
  exit 1
fi
if [ "$free_mb" -lt "$DEPLOY_MIN_FREE_MB" ]; then
  echo "  ✗ Only ${free_mb}MB free, need ${DEPLOY_MIN_FREE_MB}MB." >&2
  echo "    Refusing to start: a disk that fills mid-install corrupts binaries" >&2
  echo "    silently (issue #83). Free space, then redeploy." >&2
  echo "    Quick wins: npm cache clean --force; prune old build artifacts." >&2
  exit 1
fi
echo "  ${free_mb}MB free (minimum ${DEPLOY_MIN_FREE_MB}MB)"

echo "→ Installing dependencies"
npm ci

# Prove the CLI that the next step depends on actually survived the install.
# This is the specific corruption seen in #83, but it catches any truncated or
# half-written binary — and it fails HERE, with a readable message, instead of
# as a bare `Segmentation fault` inside `db push`. `npm rebuild supabase`
# re-downloads it; that was the manual recovery.
echo "→ Verifying supabase CLI"
# `$?` is read inside the else branch, where it still holds the tested
# command's status; reading it after the `if` has completed would report the
# `if` itself (always 0) and hide the segfault we are trying to surface.
# stderr is folded in because a corrupt binary says nothing on stdout — and
# with a segfault it may say nothing at all, hence the fallback text.
if cli_output=$(./node_modules/.bin/supabase --version 2>&1); then
  # First line only: the CLI appends an "update available" notice on stderr.
  echo "  supabase $(printf '%s' "$cli_output" | head -n 1)"
else
  cli_status=$?
  echo "  ✗ The supabase CLI is not runnable (exit ${cli_status})." >&2
  if [ -n "$cli_output" ]; then
    printf '    %s\n' "$cli_output" >&2
  else
    echo "    (no output — consistent with a segfault)" >&2
  fi
  echo "    A truncated binary from a full disk looks exactly like this," >&2
  echo "    and exit 139 is SIGSEGV (issue #83)." >&2
  echo "    Recover with: npm rebuild supabase" >&2
  exit 1
fi

# The verified local CLI, NOT `npx supabase`: npx would silently fetch a
# different version when the local one is missing, which is how a corrupt
# local binary went unnoticed — `npx supabase` resolves to the same broken
# node_modules/.bin entry, so it segfaulted identically while looking like an
# independent check.
echo "→ Applying pending migrations"
./node_modules/.bin/supabase db push --linked --include-all

# --env-file-if-exists: the seeder reads SUPABASE_* from .env, which tsx does
# not load on its own. Without it the step aborts the whole deploy on a fresh
# checkout (issue #59); this had been carried as an uncommitted edit on the
# production box, so every `git pull` risked colliding with it.
echo "→ Seeding platform admin (idempotent)"
./node_modules/.bin/tsx --env-file-if-exists=.env scripts/seed-platform-admin.ts

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
