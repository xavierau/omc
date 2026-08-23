# Deploy marked failed, site 502 — reboot cut a build in half, daemon went FATAL

**Date**: 2026-08-23
**Trigger**: Forge auto-deploy of `main` da3a7f5 (PR #112), 13:25 UTC
**Impact**: `app.ohmyclient.io` returned 502 from ~13:24 to 14:00 UTC. Other sites
on the box were unaffected.
**Related**: [2026-08-05 prod VM hang](2026-08-05-prod-vm-hang-during-deploy.md) —
same root cause, one step further along. #56 / #83 (deploy.sh guards)

## What the log said

The deploy built cleanly and then aborted at the last step:

```
✓ Compiled successfully in 46s
  Finished TypeScript in 116s ...
→ Restarting daemons
  ✗ No live supervisor program for the app (command /standalone/server\.js|npm start|next start/, fallback daemon-746791).
    A build without a restart is a failed deploy — aborting.
```

Free disk was 1938 MB and the build succeeded, so neither storage nor memory was
the proximate cause — which is where the first hour of diagnosis went.

## Root cause — a chain, not a single fault

1. **The 12:37 deploy never finished.** Its provision log
   (`/home/forge/.forge/provision-211623169.output`) ends mid-build:
   `Running TypeScript ...` / `Finished TypeScript in 64.6min ...` and then
   nothing. For comparison the 13:25 build did the same step in **116 seconds**.
   The 33× blow-up is the memory-thrash signature documented on 2026-08-05:
   e2-medium, 4 GB RAM, 1 GB swap, 17 sites.
2. **The VM rebooted at 13:23** (`last -x reboot`), killing that build partway.
   `next build` writes `prerender-manifest.json` late, so `.next/` was left
   without it.
3. **At boot the app daemon crash-looped on the partial build.** Eleven starts
   between 13:24:25 and 13:25:01, each identical:
   ```
   ✓ Ready in 254ms
   Error: ENOENT: no such file or directory, open '.../.next/prerender-manifest.json'
   ```
   Supervisor gave up at 13:25:02: `gave up: daemon-746791_00 entered FATAL
   state, too many start retries too quickly`.
4. **The 13:25:54 deploy then built fine but could not restart into it.**
   `resolve_daemon()` gated on `supervisorctl status` exiting zero — and that
   command exits non-zero for a program that exists but is not RUNNING. A FATAL
   daemon therefore read as "no such program", and the guard aborted.

So the deploy log was accurate and the guard was working as designed. It just
could not do the one thing the situation needed.

## Recovery

```bash
sudo -n /usr/bin/supervisorctl start daemon-746791:*   # → RUNNING, /api/health 200
```

The build on disk was already complete and current (`BUILD_ID` written 13:29);
nothing needed rebuilding. Same last step as 2026-08-05.

## Latent bugs this surfaced

Found while writing the fix; all three had been live for months.

- **`resolve_daemon` used `sudo -n grep`** on `/etc/supervisor/conf.d/`. That is
  not in the forge sudoers allowlist (only `supervisorctl` is), so it exited 1
  with "a password is required" on *every* deploy, matched nothing, and always
  fell through to the hardcoded `daemon-NNNNNN` fallback. The
  robustness-to-renumbering the function exists to provide was never in effect.
  The directory is world-readable; a plain `grep` works.
- **`no such group` was not recognised.** Queried as `name:*` supervisor answers
  `ERROR (no such group)`; only the bare-name form says `no such process`. The
  check looked for the latter, so a daemon that does not exist resolved as live.
- **`restart_daemon` treated `BACKOFF`/`EXITED` as terminal.** Both are
  transient — they resolve to RUNNING or FATAL — so a slow-booting daemon could
  fail a deploy that would have succeeded.

## Fix

`next build` no longer runs on production. `scripts/release.sh` builds on a
developer machine and force-pushes an orphan `release` branch carrying the
source tree plus a complete, verified `.next/`; `deploy.sh` installs deps,
migrates, seeds and restarts. This is the "stop building on the production host"
prevention item the 2026-08-05 journal already recommended.

`deploy.sh` also now:

- verifies the bundle before touching anything — including
  `prerender-manifest.json`, the exact file whose absence caused step 3 — so a
  truncated build fails loudly with the old release still serving, instead of
  crash-looping;
- starts a FATAL/STOPPED daemon instead of aborting, so a recovery deploy is no
  longer guaranteed to be marked failed;
- skips `npm ci` when `package-lock.json` is unchanged, which shrinks the window
  where an interrupted install leaves the box with no `node_modules` (that is
  what turned 2026-08-05 from an outage into a longer outage);
- refuses to deploy a bundle containing `.next/standalone/.env`.

That last one is not hypothetical: `output: 'standalone'` copies the build
machine's `.env` verbatim into the bundle, and the copy on production was
byte-identical to the real `.env` — 24 variables including the Supabase service
role key, Kapso API key and webhook secret, and the platform admin password.
**`xavierau/omc` is a public repo**, so shipping bundles through a branch makes
that file a credential leak. `release.sh` strips every `.env` and then scans the
result for service_role JWTs and `sb_secret_`/`sbp_` keys before it will push.

## Still outstanding

- **The box has no headroom.** Removing the build removes the spike, but
  e2-medium with 1 GB swap running 17 sites is still the underlying problem, and
  the 2026-08-05 recommendation to resize to `e2-standard-2` stands.
- **Disk sat at 93%** (2.2 GB free) at the time of the incident. `npm cache clean
  --force` recovered 387 MB; `/var/log/journal` was **2.0 GB** with no
  `SystemMaxUse` cap and `/var/cache/apt` another 639 MB. Journald should be
  capped so it cannot creep back.
- **The worker still needs full `node_modules`** (`tsx scripts/start-worker.ts`),
  which is ~1 GB on disk and the only reason `npm ci` remains in the deploy.
  Bundling the worker at release time would let production drop `node_modules`
  entirely.
