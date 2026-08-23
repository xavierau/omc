#!/usr/bin/env bash
set -euo pipefail

# Runs on the production host, against a checkout of the `release` branch.
#
# The build is NOT here any more — scripts/release.sh runs it on a developer
# machine and publishes the finished `.next/` to `release`. See that script's
# header, and debugging_journals/2026-08-05-prod-vm-hang-during-deploy.md, for
# why: `next build` is the only step that needed gigabytes, and on a 4 GB box
# shared by 17 sites it twice took production down — once by thrashing the
# kernel until sshd stopped answering, once by being interrupted mid-write and
# leaving a `.next/` that the app daemon crash-looped on.
#
# What remains is cheap and bounded: deps, migrations, seeder, restart.

# Sync with the published release before anything else. Forge's stock deploy
# script consumes the site branch with `git pull` — and a pull can NEVER land
# this repo's `release` branch: it is an orphan commit force-pushed on every
# release, so each new tip shares no history with the one before it. The pull
# exits 128 ("refusing to merge unrelated histories") and, because the stock
# script does not `set -e`, the deploy carries on against the STALE checkout —
# silently redeploying the previous release while the log claims success.
# deploy/README.md documents the fetch+checkout deploy script that avoids
# this; the block below makes the deploy correct even where that script edit
# is missing or gets reverted.
#
# Deliberately scoped to a checkout already ON the release branch: a
# main/develop checkout must keep failing at the RELEASE.json guard below with
# instructions, not be silently switched to a branch Forge was not told to
# deploy. The first cutover therefore still needs the README's deploy-script
# step; this handles every deploy after it.
if [ "${OMC_DEPLOY_SYNCED:-0}" != "1" ] && [ "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)" = "release" ]; then
  echo "→ Syncing checkout with origin/release"
  remote_tip=$(git ls-remote --heads origin refs/heads/release | awk '{print $1}')
  if [ -z "$remote_tip" ]; then
    echo "  ✗ origin has no 'release' branch — publish one first (npm run build:release)." >&2
    exit 1
  fi
  if [ "$(git rev-parse HEAD)" = "$remote_tip" ]; then
    echo "  already at ${remote_tip:0:7}"
  else
    # Fetch the branch explicitly: this checkout's refspec may only track
    # develop (the production box's does), so remote-tracking refs are not
    # trustworthy — FETCH_HEAD is exact. reset --hard rather than merge or
    # checkout because the new tip shares no history with HEAD and must also
    # overwrite anything stale at tracked paths.
    git fetch origin refs/heads/release
    git reset --hard FETCH_HEAD
    echo "  reset to ${remote_tip:0:7}"
    # deploy.sh itself may have just changed on disk, and bash reads the file
    # incrementally — continuing in this process would execute a byte-offset
    # mix of the old and new script. Re-exec the synced copy exactly once.
    OMC_DEPLOY_SYNCED=1 exec bash "$0"
  fi
fi

# Free space required before we touch anything (issue #83). A deploy that
# refuses to start is far cheaper than one that half-succeeds: when the disk
# filled mid-`npm ci`, npm reported "added 840 packages" while writing a
# TRUNCATED supabase binary (73MB on disk, ELF header describing 96MB of
# sections). Every later invocation segfaulted, and the deploy died three
# steps further on with `Segmentation fault` and no hint of the real cause.
#
# `npm ci` still needs roughly a gigabyte for node_modules plus a regrowing npm
# cache. The build's ~130MB is gone from this budget, but the floor stays where
# it is: node_modules is the larger half, and this host runs eight sites on a
# 29GB volume. Raise it via DEPLOY_MIN_FREE_MB once the volume grows; growing
# the volume is the actual fix.
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
  echo "    Quick wins: npm cache clean --force; sudo journalctl --vacuum-size=200M;" >&2
  echo "                sudo apt-get clean" >&2
  exit 1
fi
echo "  ${free_mb}MB free (minimum ${DEPLOY_MIN_FREE_MB}MB)"

# Because the build now happens elsewhere, the checkout MUST already carry one.
# This is the guard that would have caught 2026-08-23: the app was started
# against a `.next/` whose prerender-manifest.json had never been written, and
# the only symptom was eleven identical ENOENT crash-loops in a daemon log
# nobody was watching. Fail here, loudly, with the app still serving the
# previous release — rather than restart into a bundle that cannot boot.
echo "→ Verifying prebuilt bundle"
# RELEASE.json is the marker, NOT the presence of .next/ — that distinction is
# load-bearing. A server that used to build in place still has a .next/ lying
# around from the last such build, so "a .next exists" does not mean "this
# checkout carries a release". Keying off .next/ would let a deploy of
# main/develop sail past this check and restart the app against a STALE build,
# silently serving the previous release while the log claims success. Only
# release.sh writes RELEASE.json, and only into the bundle it just built.
if [ ! -f RELEASE.json ]; then
  echo "  ✗ This checkout is not a release bundle (no RELEASE.json)." >&2
  if [ -d .next ]; then
    echo "    There IS a .next/ here, but it is a leftover from when this host" >&2
    echo "    built in place — deploying it would restart into a stale build." >&2
  fi
  echo "    Forge must deploy the 'release' branch, which scripts/release.sh" >&2
  echo "    publishes — not main/develop." >&2
  echo "    Fix: build a release from a dev machine (npm run build:release)," >&2
  echo "    then set Site → Repository → Branch to 'release' in the Forge UI." >&2
  exit 1
fi
if [ ! -d .next ]; then
  echo "  ✗ RELEASE.json is present but there is no .next/." >&2
  echo "    The published bundle is broken — re-run scripts/release.sh." >&2
  exit 1
fi
# BUILD_ID and prerender-manifest.json are written late by `next build`, so
# their presence is a reasonable proxy for "the build ran to completion".
for required in .next/BUILD_ID .next/prerender-manifest.json .next/routes-manifest.json; do
  if [ ! -f "$required" ]; then
    echo "  ✗ Incomplete build: ${required} is missing." >&2
    echo "    The bundle on this branch is truncated — do not restart into it." >&2
    echo "    Re-run scripts/release.sh on a dev machine and push again." >&2
    exit 1
  fi
done
# The bundle must never CARRY an env file: `output: 'standalone'` copies the
# build machine's .env verbatim into .next/standalone/.env, and this repo is
# public. release.sh scrubs it, but a bundle published before that guard
# existed — or by hand — would not be scrubbed, so re-check on arrival.
#
# Check what the COMMIT tracks, not what is on disk: the deploy itself places
# a local copy of the server's own .env at that exact path (below), and a
# leftover from the in-place-build era may sit there untracked too. Only a
# TRACKED env file means the public branch is carrying credentials. Scans the
# WHOLE tracked tree (not just .next/) so a hand-published bundle with an env
# file anywhere is caught; spares .env.example — the same set release.sh
# scrubs.
tracked_env=$(git ls-files | grep -E '(^|/)\.env(\.[^/]+)?$' | grep -v '\.env\.example$' || true)
if [ -n "$tracked_env" ]; then
  echo "  ✗ The release bundle carries env file(s) in git:" >&2
  printf '%s\n' "$tracked_env" | sed 's/^/      /' >&2
  echo "    Those are copies of the BUILD MACHINE's .env and this repo is" >&2
  echo "    public. Treat every credential in them as compromised and rotate" >&2
  echo "    them all. Rebuild with scripts/release.sh, which scrubs them." >&2
  exit 1
fi
# Same idea for runtime logs. Next's file tracing copies the build machine's
# logs/ directory (webhook payloads — customer names, phone numbers) into
# .next/standalone/logs/, and a bundle published outside release.sh ships it:
# the 2026-08-23 bootstrap publish put 88 files of PRODUCTION webhook logs on
# the public release branch. release.sh prunes and refuses; this catches what
# arrives anyway. The source tree tracks no *.log, so any hit is a leak.
tracked_logs=$(git ls-files | grep -E '\.log$' || true)
if [ -n "$tracked_logs" ]; then
  echo "  ✗ The release bundle carries log file(s) in git (customer PII):" >&2
  printf '%s\n' "$tracked_logs" | sed -n '1,5p' | sed 's/^/      /' >&2
  echo "      ($(printf '%s\n' "$tracked_logs" | wc -l | tr -d ' ') total)" >&2
  echo "    This repo is public — treat the data as exposed. Delete the" >&2
  echo "    release branch, purge via GitHub Support, and republish with" >&2
  echo "    scripts/release.sh (which prunes logs and refuses to push them)." >&2
  exit 1
fi
# The standalone server reads env ONLY from its own directory: server.js does
# process.chdir(__dirname) and @next/env then loads .env from there — the
# site-root .env is invisible to the app process. The in-place build used to
# create this copy as a side effect (it is what production ran on all along);
# now that release.sh scrubs it from the bundle, the deploy must place it.
# Refreshed on every deploy so edits in Forge UI → Environment propagate.
echo "→ Installing runtime env for the standalone server"
if [ ! -f .env ]; then
  echo "  ✗ No .env in the site root — the app cannot boot without one." >&2
  echo "    Forge UI → Site → Environment writes it." >&2
  exit 1
fi
# No mkdir -p: a bundle without .next/standalone/ has no standalone build at
# all, and inventing the directory would defer that to a FATAL daemon later.
if [ ! -d .next/standalone ]; then
  echo "  ✗ The bundle has no .next/standalone/ — the build was not made with" >&2
  echo "    output: 'standalone'. Re-run scripts/release.sh on a dev machine." >&2
  exit 1
fi
cp .env .next/standalone/.env
chmod 600 .next/standalone/.env
echo "  site .env → .next/standalone/.env"
# Provenance matters more than usual here: `release` is an orphan branch
# rewritten on every deploy, so its own git history cannot tell you what is
# running. RELEASE.json is the only link back to a real commit.
#
# The BUILD_ID cross-check catches a bundle assembled from mismatched parts —
# a RELEASE.json from one build next to a .next/ from another, which is what a
# half-applied git pull or a hand-edited branch looks like.
#
# Plain `node`, not tsx: this runs BEFORE the install step, so node_modules may
# not exist yet (and on a first deploy to this branch, definitely does not).
# Node itself is a given — it is what serves the app.
echo "  BUILD_ID $(cat .next/BUILD_ID)"
if ! node -e '
  const fs = require("fs");
  const r = JSON.parse(fs.readFileSync("RELEASE.json", "utf8"));
  const onDisk = fs.readFileSync(".next/BUILD_ID", "utf8").trim();
  if (r.build_id !== onDisk) {
    console.error(`  ✗ RELEASE.json says BUILD_ID ${r.build_id}, but .next/BUILD_ID is ${onDisk}.`);
    console.error("    This bundle is assembled from two different builds — do not deploy it.");
    console.error("    Re-run scripts/release.sh on a dev machine.");
    process.exit(1);
  }
  console.log(`  from ${r.source_ref} @ ${String(r.source_commit).slice(0, 7)} — ${r.source_subject}`);
  console.log(`  built ${r.built_at} by ${r.built_by} on node ${r.node}`);
'; then
  exit 1
fi

# `npm ci` deletes node_modules before repopulating it. That window is not
# academic: on 2026-08-05 an interrupted `npm ci` left the tree with no
# node_modules at all, and the app daemon crash-looped on `next: not found`.
# The lockfile changes on a minority of deploys, so skip the churn — and the
# window — whenever the installed tree already matches it.
echo "→ Installing dependencies"
lock_hash=$(sha256sum package-lock.json | awk '{print $1}')
lock_stamp="node_modules/.omc-lock-hash"
if [ -d node_modules ] && [ -f "$lock_stamp" ] && [ "$(cat "$lock_stamp")" = "$lock_hash" ]; then
  echo "  lockfile unchanged (${lock_hash:0:12}) — node_modules is current, skipping npm ci"
else
  npm ci
  # Written only after a clean install, so an interrupted one re-runs next time
  # instead of being mistaken for current.
  printf '%s' "$lock_hash" > "$lock_stamp"
  echo "  installed (lockfile ${lock_hash:0:12})"
fi

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

echo "→ Restarting daemons"
# The app + worker run under Forge/supervisor with AUTO-GENERATED numeric program
# names (daemon-NNNNNN) that change if a daemon is recreated — so we resolve the
# program by matching its configured command, falling back to the last-known
# name. Two hard rules (issue #56, prod login outage): a build that does not
# restart the app is a FAILED deploy, so (1) a program we can't find is fatal,
# not a silent skip, and (2) we confirm each daemon actually came back up before
# declaring success. The command patterns below match the daemons documented in
# deploy/README.md — the app runs `node .next/standalone/server.js` (output:
# 'standalone') or `npm start`, the worker runs `npx tsx scripts/start-worker.ts`.

# Resolve a supervisor group name. Prefer a command match across the Forge
# program configs (robust to renumbering — Forge names the conf file after the
# daemon group), then the last-known name; empty only if supervisor has never
# heard of either.
resolve_daemon() {
  local cmd_pattern="$1" fallback="$2" conf name out
  # Plain grep, NOT `sudo -n grep`. /etc/supervisor/conf.d is world-readable
  # (755 root:root) but the forge sudoers entry only grants supervisorctl —
  # so `sudo -n grep` fails with "a password is required" every single time.
  # This silently swallowed the match and fell through to the hardcoded
  # fallback on every deploy since the guard was written, meaning the
  # renumbering-robustness this function exists to provide was never actually
  # in effect. Verified 2026-08-23: `sudo -n grep` exits 1, plain grep finds
  # daemon-801730.conf for the worker. The sudo form is kept as a second
  # attempt purely for hosts that lock the directory down.
  conf=$(grep -rlE "command=.*(${cmd_pattern})" /etc/supervisor/conf.d/ 2>/dev/null | head -n1 || true)
  if [ -z "$conf" ]; then
    conf=$(sudo -n grep -rlE "command=.*(${cmd_pattern})" /etc/supervisor/conf.d/ 2>/dev/null | head -n1 || true)
  fi
  if [ -n "$conf" ]; then
    name=$(basename "$conf" .conf)
  else
    name="$fallback"
  fi
  # Gate on whether supervisor KNOWS this program, not on whether it is up.
  # `supervisorctl status` exits non-zero for a program that exists but is not
  # RUNNING — and FATAL is precisely the state a half-finished deploy leaves
  # behind. The old exit-status test therefore reported "no live program" and
  # aborted, which meant the RECOVERY deploy was guaranteed to be marked failed
  # even when it had worked. That bit us on 2026-08-05 and again on 2026-08-23;
  # both times the fix was a human running `supervisorctl start` by hand.
  out=$(sudo -n /usr/bin/supervisorctl status "${name}:*" 2>&1 || true)
  # Both spellings matter: queried as a group (`name:*`) supervisor answers
  # "ERROR (no such group)", while a bare name gives "ERROR (no such process)".
  # Matching only the latter — as the first draft of this did — accepts a
  # program that does not exist and then reports a confusing restart failure
  # instead of the accurate "supervisor has no such daemon".
  if [ -n "$out" ] && ! printf '%s' "$out" | grep -qiE 'no such (process|group)'; then
    printf '%s' "$name"
  fi
}

# Bring a daemon up and confirm it stayed up. Verifying via supervisor state
# (rather than an HTTP probe) is deliberate: it makes no assumption about the
# app's port or whether Node vs nginx serves /_next/static — a program that
# reaches RUNNING after the restart is serving the freshly built .next.
restart_daemon() {
  local label="$1" cmd_pattern="$2" fallback="$3" name status verb
  name=$(resolve_daemon "$cmd_pattern" "$fallback")
  if [ -z "$name" ]; then
    echo "  ✗ Supervisor has no program for the ${label} (command /${cmd_pattern}/, fallback ${fallback})." >&2
    echo "    A build without a restart is a failed deploy — aborting." >&2
    echo "    Check the daemon still exists: Forge UI → Site → Daemons." >&2
    exit 1
  fi

  # `restart` on a stopped program errors on the implicit stop; `start` on a
  # running one errors too. Pick the verb that matches the current state so a
  # FATAL daemon is revived instead of reported as an unrecoverable failure.
  status=$(sudo -n /usr/bin/supervisorctl status "${name}:*" 2>&1 || true)
  if printf '%s' "$status" | grep -qE '\bRUNNING\b'; then
    verb=restart
  else
    verb=start
    echo "  ${label} (${name}) is not running: $(printf '%s' "$status" | awk '{print $2}' | head -n1)"
  fi

  echo "  ${verb}ing ${label} → ${name}"
  # Non-zero is not decisive here — supervisorctl reports errors for races that
  # resolve fine. The state poll below is the actual verdict.
  sudo -n /usr/bin/supervisorctl "$verb" "${name}:*" || true

  for _ in $(seq 1 15); do
    status=$(sudo -n /usr/bin/supervisorctl status "${name}:*" 2>/dev/null || true)
    # FATAL is terminal — supervisor has exhausted its retries and will not try
    # again, so waiting cannot help. BACKOFF and STARTING are transient by
    # definition (they resolve to RUNNING or FATAL), so keep polling through
    # them rather than failing a daemon that is simply slow to boot.
    if printf '%s' "$status" | grep -q 'FATAL'; then
      echo "  ✗ ${label} (${name}) is FATAL: ${status}" >&2
      echo "    It crash-looped until supervisor gave up. The log has the reason:" >&2
      echo "      tail -50 /home/forge/.forge/${name}.log" >&2
      exit 1
    fi
    if printf '%s' "$status" | grep -q 'RUNNING'; then
      echo "  ${label} is RUNNING"
      return 0
    fi
    sleep 2
  done
  echo "  ✗ ${label} (${name}) did not reach RUNNING after ${verb}: ${status}" >&2
  exit 1
}

restart_daemon "app"    "standalone/server\.js|npm start|next start" "daemon-746791"
restart_daemon "worker" "start-worker"                               "daemon-801730"

echo "✓ Deploy complete"
