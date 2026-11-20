---
id: deploys/2026-11-20-camp-016-release-runbook
type: deploy
author: dev
created: 2026-11-20
status: executed
supersedes: null
superseded_by: null
related: [kanban:CAMP-016, github:200, github:202, artifacts/2026-11-20-rel-camp-016-handoff, artifacts/2026-11-19-dev-camp-016-r3-handoff, artifacts/2026-11-19-camp-016-plan, deploys/2026-11-19-agent-003-release-runbook, deploys/2026-11-19-book-004-release-runbook]
---

# Deploy: CAMP-016 audience quality + lapsed filters: `main` @ `188bf93a` to production

**Outcome: DEPLOYED 2026-11-19 17:00Z (2026-11-20 01:00 HKT). Migration 086 was applied before the daemons
restarted. Every row, column and grant check passes. Every read-only smoke check passes.** Prod serves
`main@188bf93a`, release **`b40e2e29`**, BUILD_ID **`nUUD8IZ3cKKd62nx1V0ws`**. App next-server pid **3321221**,
worker pid **3321288** (`npm exec`; node child 3321440).

Stage: POC (the repo does not import `stages/mature.md`). Hosting: the existing Forge box; the `fly-deploy` and
Cloudflare rules do not apply. Go: Xavier, 2026-11-20 ("merge and release"), relayed by main. Repo `xavierau/omc`
is **public**: no tenant id, user id, email, phone number, message text or secret appears below or in the evidence.
All times are UTC.

## Scope
- `main` before: **`f1fa26b8`** (BOOK-004 release). `main` now: **`188bf93a`** = merge of release PR **#202**
  (develop `3c3b553d` → main), which brings:
  - `3c3b553d` CAMP-016 (PR #200 squash): tenant defaults for "skip low-quality contacts" (off / red / red_yellow,
    default red) and "lapsed after N days" (default 30) in Settings → Campaigns; a per-campaign snapshot of both;
    one server-side resolver (`campaign_audience_rated` → `_members` / `_counts`) for the form count and the send;
    Settings regrouped into `/dashboard/setup/<group>`.
  - `275785f2` BOOK-004 release docs (#201, workspace records only).
- Delta `f1fa26b8..188bf93a`: under `supabase/` only **`migrations/086_campaign_audience_quality.sql`**. No change to
  `package.json`, `package-lock.json`, `scripts/`, `deploy.sh` or `.env.example`. So `npm ci` was skipped on the
  box, no env var was added and no cron route is new.
- 086 is additive: two NOT NULL columns with defaults on `tenant_campaign_settings`, two on `campaigns` (defaults =
  the pre-086 behaviour), three `STABLE` SQL functions, REVOKE from PUBLIC/anon/authenticated + GRANT service_role.
- Target: `https://app.ohmyclient.io`, Forge server 1149990 / site 3123752, checkout
  `/home/forge/app.ohmyclient.io` on `release`. Supabase prod `whatsapp-crm-pro`.
- Previous prod: `main@f1fa26b8`, release **`79c2634f`**, BUILD_ID `3swaJrxsFle8BXKvCxYCZ`, app pid 3267575,
  worker pid 3267616.
- Executed from a fresh detached worktree `/Users/xavierau/Code/js/whatsapp-crm--release-camp016` at `3c3b553d`,
  with `.env.local` and `.env.production.local` copied from the primary checkout (`cmp` identical, gitignored, never
  committed). The primary checkout and every other worktree were not touched; nothing was stashed.

## Pre-Flight
- [x] **Gate** on `3c3b553d` under the heavy lock, 16:49:18–16:51:15Z. Exit codes read from files
      (`artifacts/evidence/2026-11-20-camp-016-release/ac-gate-*`):
  - `npm ci` exit 0 (fresh tree, no `node_modules`).
  - `tsc --noEmit` exit 0.
  - `vitest run` exit 0: **661 files passed / 14 skipped, 7,528 tests passed, 127 skipped, 2 todo**.
  - The released tree (`188bf93a`) has the same tree as `3c3b553d` (`0f35c427…`).
- [x] **Backup, confirmed before the merge and before 086** (16:48:33Z, `box-preflight.log`). Managed physical
      backup **2306777673 COMPLETED 2026-11-18T19:32:11Z** (7 dailies, WAL-G on, PITR off; the newest; the next
      daily is due 19:32Z, after this release). Box `/home/forge/backups/2026-11-20-camp-016/` (700, files 600):
      | file | content | sha256 |
      |---|---|---|
      | `managed-backups.json` | backup list | `f9e37b6ef0a2f4bf397e311bc559e0de0da005197494fca66598107cb08918c1` |
      | `tenant_campaign_settings.json` | full rows, 7 | `7ca6929409e2faca8c5266cd6adc041e6a092c638ffa779a2738900676df79b3` |
      | `campaigns.json` | full rows, 46 | `260cace91f6736b184151716a4e5c74ca98cab56e26d56b0f3879ead9c4c6b7a` |
      | `baseline-catalog.json` | catalog | `e1ba77ec43092894f3fbdfe5c57399bcdaa9bc00730885f29678036524356acb` |
      Baseline: ledger tail 082–**085**, no 086, so `db push --include-all` could apply only 086. No
      `audience_*` column on `campaigns`, no `skip_contact_quality` / `lapsed_after_days`, no `campaign_audience*`
      function. Counts: restaurants 7, tenant_campaign_settings 7 (0 restaurants without a row),
      `monthly_send_limit` 1000 × 6 and 10000 × 1, campaigns 46 (15 active, 26 completed, 5 failed), members 4,227
      (all active).
- [x] **Box (16:48:33Z).** Disk 27,363 MB free (floor 3 GB; deploy.sh floor 1,500 MB), MemAvailable 2,372 MB, load
      0.19. Swap 7 MB free but idle, as in the AGENT-003 precedent (9 MB). The build is off-box and `npm ci` is
      skipped, so nothing on the box needs memory beyond the restart.
- [x] **Restore point.** `origin/release` (`79c2634f`) fetched as the local ref **`release-backup-79c2634`** (not
      pushed).

## Runbook (as executed)
```
cd /Users/xavierau/Code/js/whatsapp-crm
rtk proxy git fetch origin
rtk proxy git worktree add --detach /Users/xavierau/Code/js/whatsapp-crm--release-camp016 3c3b553d
cp .env.local .env.production.local /Users/xavierau/Code/js/whatsapp-crm--release-camp016/      # cmp identical
# box: Forge site commands. Query helper reads SUPABASE_ACCESS_TOKEN / service key from the site .env in memory
#      (never printed); managed-backup list, baseline catalog, row copies → /home/forge/backups/2026-11-20-camp-016/
cd /Users/xavierau/Code/js/whatsapp-crm--release-camp016
resource-lock.py heavy -- bash -c 'npm ci; npx tsc --noEmit; npx vitest run'               # all exit 0
rtk proxy git merge-tree --write-tree origin/main origin/develop                          # exit 0, tree == develop
gh pr create --base main --head develop                                                   # #202, MERGEABLE/CLEAN, CodeRabbit pass
gh pr merge 202 --merge --match-head-commit 3c3b553d…                                     # 16:56:06Z → 188bf93a
rtk proxy git fetch origin refs/heads/release:refs/heads/release-backup-79c2634            # 79c2634f
rtk proxy git checkout -B rel-camp016 188bf93a
timeout 120 rtk proxy git push origin rel-camp016:refs/heads/rel-camp016                   # ls-remote 188bf93a ✓
SOURCE_REF=rel-camp016 resource-lock.py heavy -- bash scripts/release.sh                    # exit 0, 16:56:42–16:59:09Z
git ls-remote origin refs/heads/release                                                     # b40e2e29 ✓ (was 79c2634f)
# Forge auto-deploy 83484463: deploy.sh → supabase db push (086) → seed → restart app + worker
timeout 120 rtk proxy git push origin --delete rel-camp016                                  # ls-remote empty ✓
```
release.sh tail (`release-sh.log`):
```
→   building rel-camp016 @ 188bf93
→   node v22.21.1
→   BUILD_ID nUUD8IZ3cKKd62nx1V0ws
→ Scanning bundle for inlined credentials
→   clean
 + 79c2634f...b40e2e29 b40e2e29dc0a9ea0531616e7a576c82b24e9ad2b -> release (forced update)
✓ Released rel-camp016 @ 188bf93 → origin/release (b40e2e2)
```

**Migration ordering, from the Forge deployment log** (`GET …/deployments/83484463/log`, redacted copy
`forge-deploy-83484463.log`):
```
Thu Nov 19 16:59:35 UTC 2026
  already at b40e2e2
  27341MB free (minimum 1500MB)
  BUILD_ID nUUD8IZ3cKKd62nx1V0ws
  from rel-camp016 @ 188bf93 — Merge pull request #202 from xavierau/develop
  lockfile unchanged (5b141452304d) — node_modules is current, skipping npm ci
→ Applying pending migrations
 • 086_campaign_audience_quality.sql
Applying migration 086_campaign_audience_quality.sql...
NOTICE (00000): function public.campaign_audience_members(…,int4,int4) does not exist, skipping
Finished supabase db push.
→ Seeding platform admin (idempotent)
→ Restarting daemons
  app is RUNNING
  worker is RUNNING
✓ Deploy complete
```
The NOTICE is 086's own `DROP FUNCTION IF EXISTS` for the unreleased first cut's OFFSET signature: expected on a
database that never ran that cut. deploy.sh runs under `set -euo pipefail`, so a failed 086 would have stopped the
deploy before either restart; `Finished supabase db push.` precedes both restarts.

## Deploy facts
| time (UTC) | event |
|---|---|
| 16:56:06 | main merge commit `188bf93a` (PR #202) |
| 16:58:55 | bundle built on the Mac (node v22.21.1) |
| 16:59:09 | `release` force-pushed → `b40e2e29`; Forge deployment 83484463 starts 16:59:10 |
| 16:59:35 | deploy.sh starts; checkout already at `b40e2e2`; 27,341 MB free; `npm ci` skipped |
| 16:59:35–~16:59:55 | `supabase db push`: **086 applied**, `Finished supabase db push.` |
| ~16:59:55 | app daemon-746791 → **next-server 3321221** (`✓ Ready in 1809ms`) |
| ~17:00:00 | worker daemon-801730 → **pid 3321288** (`npm exec`; node 3321440); `Workers started: campaign, event-dispatch, receipt, email-send, integration-inbound, integration-outbound, agent-reply` |
| 17:00:04 | Forge deployment 83484463 finished |
| 17:01:38 | box `RELEASE.json`: source_ref `rel-camp016`, source_commit `188bf93a…`, build_id `nUUD8IZ3cKKd62nx1V0ws` == `.next/BUILD_ID`; HEAD `b40e2e29` |

## Migration 086 result (read-only, Management API from the box, 17:00:40Z; `migration-086-checks.log`)
| check | before (16:48Z) | after (17:00Z) |
|---|---|---|
| ledger tail | 082 … **085** | 084, 085, **086 campaign_audience_quality** |
| `tenant_campaign_settings.skip_contact_quality` | absent | text NOT NULL DEFAULT `'red'` |
| `tenant_campaign_settings.lapsed_after_days` | absent | integer NOT NULL DEFAULT `30` |
| `campaigns.audience_skip_quality` | absent | text NOT NULL DEFAULT `'off'` |
| `campaigns.audience_lapsed_days` | absent | integer NULL, no default |
| tcs rows / restaurants without a row | 7 / 0 | **7 / 0** |
| tcs `monthly_send_limit` by value | 1000 × 6, 10000 × 1 | **1000 × 6, 10000 × 1** |
| tcs per row (vs `tenant_campaign_settings.json`) | — | **7 of 7** same `monthly_send_limit`, `red`, `30`; 0 mismatches |
| tcs `skip_contact_quality` / `lapsed_after_days` | — | `red` × 7 / `30` × 7 |
| campaigns | 46 | **46**; per row vs `campaigns.json`: **46 of 46** read `off` / NULL, 0 mismatches |
| members (active) | 4,227 (4,227) | 4,227 (4,227) |
| functions | none | `campaign_audience_rated(…11 args)`, `campaign_audience_members(…, integer, uuid)` (keyset; the only signature), `campaign_audience_counts(…11 args)` |
| EXECUTE grants, all three | — | anon **false**, authenticated **false**, service_role true; ACL `{postgres=X, service_role=X}` (no PUBLIC entry) |
Box files: `after-catalog.json` (sha256 `f7ec6ff5629297f3…`), `tcs-after.json` (`c82def016688180e…`),
`campaigns-after.json` (`dd6c09a64b479db2…`), all 600.

## Post-Deploy Verification (read-only, no data created, no campaign send, no settings write; ALL PASS)
| check | result |
|---|---|
| release | `git ls-remote origin refs/heads/release` = `b40e2e29dc0a9ea0531616e7a576c82b24e9ad2b` (was `79c2634f`) |
| served build | `/login` **200**, embeds `nUUD8IZ3cKKd62nx1V0ws` once and the old BUILD_ID 0 times; `/api/health` **200** |
| Settings pages | `/dashboard/setup/campaigns`, `/dashboard/setup/welcome`, `/dashboard/setup` **307 → /login** (unauthenticated), no 5xx |
| CAMP-016 APIs (unauthenticated) | `GET /api/dashboard/settings/campaigns` **401**; `GET …/settings/campaigns/quality` **401**; `POST /api/dashboard/campaigns/audience-count` **401** (all `{"error":"Unauthorized"}`) |
| resolver, service role (PostgREST RPC, the app's path) | largest tenant (2,519 active members, id withheld), `p_audience all`, window 90, thresholds 0.9 / 0.6: lapsed none + skip off → audience **2,519** == active, will_receive 2,519; lapsed 30 + skip red (the new tenant default) → after_lapsed 2,516, green 1,685 / yellow 466 / red 365 / no data 0, **will_receive 2,151 ≤ 2,519**. HTTP 200, 183–492 ms |
| resolver, anon key | **401** `42501 permission denied for function campaign_audience_counts` |
| processes | app 3267575 → **3321221**, worker 3267616 → **3321288**: both changed |
| logs | 0 new error lines in 10 min (below); box after: MemAvailable 2,511 MB, swap 36 MB free, disk 27,333 MB free, load 0.20 |
| not run | authenticated UI, any tenant login, any campaign send or settings write (brief: smoke is read-only) |

The first RPC run (`rpc-smoke-and-box.log`, run 1) compared against an active-member count read through a
`members` select that PostgREST capped at max-rows, so its `will_receive<=active: false` is an artifact of that read.
Run 2 counts with `Prefer: count=exact` per tenant; its numbers are the ones above.

**10-minute log window** (restart ~16:59:55Z → checked 17:10:42Z, app elapsed 10:47, worker 10:40, no restart; `box-stability.log`): **0 new error lines**.
- App: lines after `Ready` are `Running next.config.ts`, the known `"next start" does not work with "output:
  standalone"` warning, and `[Kapso] Error listing templates: WhatsApp configuration not found` (a `console.warn` in
  `src/infrastructure/kapso/template-client.ts`). The Kapso line is **pre-existing**: 9,121 occurrences across the
  log's earlier run segments, 18 in the BOOK-004 segment alone (`app-log-kapso-history.log`). CAMP-016 does not touch
  that client; its only change in `src/app/dashboard/page.tsx` is the Generate-QR link href. Not a new error line.
- Worker: 0 lines after `Workers started`.

## Rollback (ready, NOT executed; ETR ≈ 3 min for code)
1. **Code** to the BOOK-004 release (`79c2634f` = `main@f1fa26b8`, BUILD_ID `3swaJrxsFle8BXKvCxYCZ`). This is a
   force-push to `release` and **needs Xavier's OK**:
   ```
   # from any worktree of this repo (local refs are shared)
   rtk proxy git push --force origin release-backup-79c2634:refs/heads/release
   git ls-remote origin refs/heads/release      # must read 79c2634fb2eb531d478b50e628971bd4095f5365
   # Forge redeploys: RELEASE.json source_commit f1fa26b8, BUILD_ID 3swaJrxsFle8BXKvCxYCZ, both pids change, /api/health 200.
   # deploy.sh's db push then reports "Remote database is up to date" (086 stays; see 2).
   ```
   If the local ref is gone, force-push by SHA `79c2634fb2eb531d478b50e628971bd4095f5365`.
   Old code with 086 in place is safe: it never selects or writes the four new columns (the inserts get their
   defaults) and never calls the three functions; campaigns created by the new code keep their snapshot but the
   old send path ignores it (it reads `schedule.inactiveDays` as before).
2. **086 stays by default** (additive). A DB revert is a separate owner decision, after step 1 (the new code reads the
   columns and functions). Down-steps, in one transaction via the Management API:
   ```sql
   BEGIN;
   DROP FUNCTION IF EXISTS public.campaign_audience_counts(uuid, text, uuid[], uuid[], uuid, int, boolean, text, int, float8, float8);
   DROP FUNCTION IF EXISTS public.campaign_audience_members(uuid, text, uuid[], uuid[], uuid, int, boolean, text, int, float8, float8, int, uuid);
   DROP FUNCTION IF EXISTS public.campaign_audience_rated(uuid, text, uuid[], uuid[], uuid, int, boolean, text, int, float8, float8);
   ALTER TABLE campaigns DROP COLUMN IF EXISTS audience_lapsed_days, DROP COLUMN IF EXISTS audience_skip_quality;
   ALTER TABLE tenant_campaign_settings DROP COLUMN IF EXISTS lapsed_after_days, DROP COLUMN IF EXISTS skip_contact_quality;
   DELETE FROM supabase_migrations.schema_migrations WHERE version = '086';
   COMMIT;
   ```
   Data lost by the revert: only the tenants' saved filter defaults and new campaigns' filter snapshots; no
   pre-086 value changes. `monthly_send_limit` is untouched by 086 and by this revert. Pre-086 row copies:
   `/home/forge/backups/2026-11-20-camp-016/{tenant_campaign_settings,campaigns}.json`.
3. **Full restore** (only on data damage): managed backup **2306777673** (2026-11-18T19:32:11Z) via the Supabase
   dashboard; this loses everything written since, so it needs Xavier.

## Cleanup
| item | state |
|---|---|
| remote `rel-camp016` | deleted after the deploy; `ls-remote origin refs/heads/rel-camp016` empty |
| local branch `rel-camp016` | deleted (`git branch -D`) |
| local ref `release-backup-79c2634` | kept as the rollback handle |
| `origin/release` `79c2634f` → `b40e2e29` | replaced (force-push by `release.sh`, by design) |
| box `/home/forge/rel-camp016-tmp/` (query/RPC helpers, SQL; no secrets) | deleted after the records |
| box `/home/forge/backups/2026-11-20-camp-016/` | kept; delete once the release is accepted |
| worktree `--release-camp016` | removed after the docs PR was pushed (see handoff) |
| worktree `--camp-016` (`feature/camp-016-audience-quality`) | untouched (per brief) |
