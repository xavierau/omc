---
id: deploys/2026-11-22-book-009-010-release-runbook
type: deploy
author: dev
created: 2026-11-22
status: executed
supersedes: null
superseded_by: null
related: [kanban:BOOK-009, kanban:BOOK-010, github:222, github:223, github:224, github:225, artifacts/2026-11-22-rel-book009-010-handoff, plans/2026-11-20-book-009-010-plan, reviews/2026-11-21-book-010-f1-rereview, deploys/2026-11-20-book-008-release-runbook, deploys/2026-11-20-wonb-020-release-runbook]
---

# Deploy: BOOK-009 booking hours + BOOK-010 guest limits/stop + BOOK-010-RL with migrations 091, 092, 093: `main` @ `0c41a4df` to production

**Outcome: DEPLOYED 2026-11-22 13:59:05Z (21:59 HKT). Migrations 091, 092 and 093 were applied in that order before
the daemons restarted.** Prod serves `main@0c41a4df`, release **`f495266e`**, BUILD_ID **`ByP1OESC_Ry3XVBnpk-wX`**.
App next-server pid **626892**, worker pid **626977** (`npm exec`). The post-deploy catalog is exactly what 091–093
define. booking_requests is 7 → 7 with the same ids and statuses. No restaurant's `booking_config` changed, and
`bookingHours` is still unset for all 7 restaurants, so no tenant's booking behaviour changed. In the 5 minutes after the restart
the logs show no new error type: two known lines and one existing worker line ("Post-Deploy Verification").

Stage: POC (the repo does not import `stages/mature.md`). Hosting: the existing Forge box; the `fly-deploy` and
Cloudflare rules do not apply. Go: Xavier, 2026-11-22 ("deploy it to production"), relayed by main in brief
REL-BOOK009-010. It covers the release PR into main and its merge, applying 091–093 through deploy.sh's
`supabase db push`, release.sh's force-push of `release`, and the Forge auto-deploy. Repo `xavierau/omc` is
**public**: no tenant id, booking id, member id, user id, public id, email, phone, message text or secret appears
below or in the evidence (the seeded admin's email and user id are redacted in the Forge log copy). All times UTC.

The run spanned a session break. Part 1 ran on 2026-11-21 15:59–16:55Z: pre-flight, gate, backup, release PR and
merge. Part 2 ran on 2026-11-22 13:37–14:05Z: re-check, gate re-run, release, verification. Between the two
nothing moved on the box or in the DB (see "Pre-deploy re-check").

## Scope
- `main` before: **`cb855822`** (WONB-020 release records, a direct commit on main after `660f82df`).
  `main` now: **`0c41a4df`** = merge of release PR **#225** (16:54:55Z), head **`aa0d27e7`**, which is develop
  **`f1011236`** with `origin/main` merged in. It brings:
  - BOOK-009 (#222): booking hours, slot picker and booking terms on the diner page, PAP `/availability` and the AI
    agent. Migration **091_booking_terms_acceptance**: `booking_requests.terms_accepted_at`, `terms_text`, and the
    CHECK `booking_requests_terms_acceptance`.
  - BOOK-010 (#223): guest limits per slot and per meal, staff stops, the capacity block and the over-limit confirm.
    - Migration **092_booking_guest_limits**:
      - table `booking_stops` with RLS on and no policies;
      - index `booking_requests_restaurant_date_status_idx`;
      - five service-role functions: `booking_room_refusal`, `booking_room_lock`, `insert_booking_request_if_room`
        and `promote_agent_booking_with_room` (both SECURITY DEFINER), and `booking_guest_counts`.
    - Migration **093_booking_room_search_path**: the two SECURITY DEFINER functions get
      `search_path = public, pg_temp`.
  - BOOK-010-RL (#224): `GET /availability` gets its own per-IP limit of 30/min. No migration.
- Delta check, 2026-11-21 16:0xZ, re-checked at resume:
  - `origin/main..origin/develop` holds only BOOK-009, BOOK-010 and BOOK-010-RL commits (no other topic).
  - Non-workspace files changed: `src/` booking code, `scripts/book-010/` (dev-only walk and scratch-DB
    scripts) and the three migrations.
  - No change to `package.json`, `package-lock.json`, `deploy.sh`, `scripts/release.sh` or `.env.example`; no env
    var added and no cron route changed (`git diff --stat cb855822 0c41a4df` over those paths shows only the
    migrations).
- **Release PR conflicts, workspace files only.** `main` carried `cb855822` and develop did not, so
  `git merge-tree origin/main origin/develop` reported three conflicts. They were resolved on
  `chore/release-book009-010` (`aa0d27e7`), with the brief's rule:
  - `handoffs.md` and `poc-log.md`: union of both sides. Every line of develop's and main's version is present
    (0 missing each way).
  - `.claude/kanban.json`: a task-level 3-way merge on base `304dd641`. develop had added BOOK-009, BOOK-010 and
    BOOK-011; main had only moved WONB-020 from review to done. The result keeps develop's file with main's
    WONB-020 move: 207 tasks, nothing lost from either side, `JSON.parse` OK, same formatting (indent 2).
  - No conflict marker anywhere in the tree (`git grep` exit 1).
  - Outside `.claude-workspace/` and `.claude/kanban.json`, `aa0d27e7` equals develop `f1011236` (empty diff).
  - GitHub's merge commit `0c41a4df` has tree **`114ceb7d`**, the same as `aa0d27e7`, which is the tree the gate
    ran on.
- Target: `https://app.ohmyclient.io`, Forge server 1149990 / site 3123752, checkout
  `/home/forge/app.ohmyclient.io` on `release`. Supabase prod `whatsapp-crm-pro` (`uzimqndenngebzgndlhd`),
  Postgres **17.6**: 092's `UNIQUE NULLS NOT DISTINCT` needs 15+, the open question from the BOOK-010 review.
- Previous prod: `main@660f82df`, release **`c353dea9`**, BUILD_ID `xk8QzLQHF8mIsyZ55BQSi`.
  - Daemons at pre-flight: next-server 3824835, worker 3824811 (`npm exec`), up about 1 day. These pids are not the
    ones the WONB-020 record names, so the daemons restarted once after that release; the cause was not
    investigated.
- Executed from worktree `/Users/xavierau/Code/js/whatsapp-crm--release-book009`, with `.env.local` and
  `.env.production.local` copied from the primary checkout (`cmp` identical, gitignored, never committed).

## Pre-Flight (before release PR #225, opened 2026-11-21 16:37:40Z)
- [x] **Range** (2026-11-21 ~16:05Z, re-checked at 13:37Z on 11-22): `origin/develop` = `f1011236`; the delta is as
      in Scope.
- [x] **Gate** under the heavy lock:
  - **First run** on `aa0d27e7` (tree `114ceb7d`), 2026-11-21 16:17:46–16:19:38Z: `npm ci`, `tsc --noEmit` and
    `vitest run` all exit 0 (725 files passed / 17 skipped, 8,353 tests passed). Its log files were in the session
    scratchpad and are lost.
  - **Re-run** on `0c41a4df`, the same tree `114ceb7d`, 2026-11-22 13:47:43–13:48:49Z, files in the evidence:
    - `npm ci` exit 0.
    - `tsc --noEmit` exit 0 (empty log).
    - `vitest run` exit 0: **725 files passed / 17 skipped, 8,353 tests passed, 140 skipped, 2 todo**.
- [x] **Box** (2026-11-21 16:18:33Z, Forge site command 14520228, `box-preflight.log`):
  - Release state: HEAD `c353dea9`, BUILD_ID `xk8QzLQHF8mIsyZ55BQSi`, RELEASE.json source_commit `660f82df`.
  - Resources: disk **26,732 MB** free (floor 3 GB), MemAvailable **2,155 MB** (floor 1 GB), swap 11 MB free,
    load 0.31.
  - The site `.env` has a non-empty `SUPABASE_ACCESS_TOKEN` naming project `uzimqndenngebzgndlhd`, and a
    `REDIS_URL`.
- [x] **Backup** (2026-11-21 16:20:09–16:20:23Z, before the PR existed; site command 14520252, `box-backup.log`).
      The helper `/home/forge/rel-book009-tmp/q.py` (copy `box-helper-q.py`, sha256 `d2d019f3…`) calls the
      Supabase Management API's read-only query endpoint. It reads the token in-process from the site `.env` and
      never prints it. Box dir `/home/forge/backups/2026-11-22-book-009-010/` (700, files 600):
      | file | content | sha256 |
      |---|---|---|
      | `managed-backups.json` | backup list: 7 dailies, WAL-G on, PITR off; newest **2327131357 COMPLETED 2026-11-20T19:32:06Z** | `d6f5d082da3510981670613275382d48d42b0da1f45e32245426a94ab5ee5054` |
      | `booking_requests.json` | full rows, 7 | `17932eb1458fb4bbe418bed4ad5330dd0abee8b19d4bf6945e645f05367ea0d2` |
      | `restaurants-booking-config.json` | `id, booking_config`, 7 rows | `7622032ee9305f09a7c5b40a53d99ee0b5089d7620416bc54d00588e78db903e` |
      | `baseline-catalog.json` | catalog + counts | `93f426b0de12d6a8be5b8a7867e37c5639a9713da3e6015898eae0e682ca47cb` |
      | `baseline-ids.json` | booking id + status | `ecabc075e8af6ebc81536817e90eb2898c5605e38098afe4a46fa91199389f1f` |
      Baseline catalog:
      - Postgres 17.6. Ledger tail 086–**090**; no 091, 092 or 093.
      - `booking_requests`: 32 columns, no `terms_*` columns, no `booking_requests_terms_acceptance`, no
        `booking_requests_restaurant_date_status_idx`.
      - `booking_stops` absent; none of the five functions exists.
      - Counts: booking_requests **7** (confirmed 2, pending 5); restaurants 7 (booking mode off 5, simple 2).
        `bookingHours` is set for **0** restaurants; 2 have an agent-booking public id.
- [x] **Backup integrity at resume** (2026-11-22 13:38:25Z, site command 14542757, `box-backup-verify.log`): all five
      files have the sha256 above byte for byte and parse as JSON (7, 7, 7 rows; catalog 12 keys).
- [x] **Pre-deploy re-check at resume** (13:39:07Z, site command 14542764, `box-predeploy.log`). Helper `q2.py` =
      `q.py` plus a predeploy mode and a partial-apply check (copy `box-helper-q2.py`, sha256 `4da8f9e1…`):
  - The re-taken catalog has sha256 `93f426b0…`, identical to the baseline.
  - Ids are identical (`ecabc075…`): 0 gone, 0 new, 0 status changes.
  - `booking_config` is equal for all 7 restaurants.
  - **Partial-apply check:** no 091–093 ledger row, and none of the objects they create (terms columns, terms
    constraint, `booking_stops`, any of the five functions, the new index).
  - The box was unchanged: HEAD `c353dea9`, BUILD_ID `xk8QzLQHF8mIsyZ55BQSi`. Disk 26,744 MB free,
    MemAvailable 2,087 MB.
  - Baseline not re-taken, because nothing moved.
- [x] **Restore point.** `origin/release` (`c353dea9`) fetched as the local ref **`release-backup-c353dea`** (not
      pushed).

## Runbook (as executed)
```
cd /Users/xavierau/Code/js/whatsapp-crm--release-book009                                    # detached at f1011236
rtk proxy git fetch origin
rtk proxy git merge-tree --write-tree origin/main origin/develop                            # exit 1: 3 workspace conflicts
rtk proxy git checkout -B chore/release-book009-010 origin/develop
rtk proxy git merge --no-ff --no-commit origin/main                                         # resolve as in Scope
rtk proxy git commit                                                                        # aa0d27e7, tree 114ceb7d
cp ../whatsapp-crm/.env.local ../whatsapp-crm/.env.production.local .                       # cmp identical
resource-lock.py heavy -- bash -c 'npm ci; npx tsc --noEmit; npx vitest run'                # 16:17:46–16:19:38Z, all 0
# box pre-flight 14520228; backup + baseline 14520252 (16:20:09Z)
rtk proxy git fetch origin refs/heads/release:refs/heads/release-backup-c353dea              # c353dea9
timeout 120 rtk proxy git push -u origin chore/release-book009-010                           # ls-remote aa0d27e7 ✓
gh pr create --base main --head chore/release-book009-010                                    # #225 16:37:40Z, MERGEABLE/CLEAN
gh pr merge 225 --merge --match-head-commit aa0d27e7…                                        # 16:54:55Z → 0c41a4df, tree 114ceb7d
rtk proxy git checkout -B release-book009-010 0c41a4df
timeout 120 rtk proxy git push origin release-book009-010:refs/heads/release-book009-010     # ls-remote 0c41a4df ✓
# (session break; resumed 2026-11-22 13:37Z)
# backup verify 14542757; pre-deploy re-check 14542764: nothing moved, nothing partly applied
resource-lock.py heavy -- bash -c 'npm ci; npx tsc --noEmit; npx vitest run'                # re-run 13:47:43–13:48:49Z, all 0
SOURCE_REF=release-book009-010 resource-lock.py heavy -- bash scripts/release.sh             # 13:56:33–13:58:11Z, exit 0
git ls-remote origin refs/heads/release                                                       # f495266e ✓ (was c353dea9)
# Forge auto-deploy 83681104 (13:58:10–13:59:05Z): deploy.sh → db push 091, 092, 093 → seed → restart app + worker
# post-deploy box + catalog 14543095 (13:59:41Z); /availability probe (14:00:22Z); 5-min log watch (see below)
timeout 120 rtk proxy git push origin --delete release-book009-010                            # ls-remote empty ✓
rtk proxy git branch -D release-book009-010
```
release.sh tail (`release-sh.log`; built 13:57:59Z):
```
→   building release-book009-010 @ 0c41a4d
→   node v22.21.1
→   BUILD_ID ByP1OESC_Ry3XVBnpk-wX
→ Scanning bundle for inlined credentials
→   clean
 + c353dea9...f495266e f495266ea111145998d4a5d0df7c1187ea85573d -> release (forced update)
✓ Released release-book009-010 @ 0c41a4d → origin/release (f495266)
release.sh exit=0
```

**Migration ordering, proven from the Forge deployment log** (`GET …/deployments/83681104/log`, redacted copy
`forge-deploy-83681104.log`):
```
Sun Nov 22 13:58:37 UTC 2026
  already at f495266
  26725MB free (minimum 1500MB)
  BUILD_ID ByP1OESC_Ry3XVBnpk-wX
  from release-book009-010 @ 0c41a4d — Merge pull request #225 from xavierau/chore/release-book009-010
  lockfile unchanged (5b141452304d) — node_modules is current, skipping npm ci
→ Applying pending migrations
 • 091_booking_terms_acceptance.sql
 • 092_booking_guest_limits.sql
 • 093_booking_room_search_path.sql
Applying migration 091_booking_terms_acceptance.sql...
NOTICE (00000): constraint "booking_requests_terms_acceptance" of relation "booking_requests" does not exist, skipping
Applying migration 092_booking_guest_limits.sql...
Applying migration 093_booking_room_search_path.sql...
Finished supabase db push.
→ Seeding platform admin (idempotent)
→ Restarting daemons
  restarting app → daemon-746791 … app is RUNNING
  restarting worker → daemon-801730 … worker is RUNNING
✓ Deploy complete
```
deploy.sh runs under `set -euo pipefail`, so `Finished supabase db push.` comes before both restarts. The NOTICE is
091's own `DROP CONSTRAINT IF EXISTS` for a constraint that did not exist yet, which is expected.

## Deploy facts
| time (UTC) | event |
|---|---|
| 11-21 16:54:55 | main merge commit `0c41a4df` (PR #225) |
| 11-22 13:57:59 | bundle built on the Mac (node v22.21.1) |
| 13:58:10 | `release` force-pushed → `f495266e`; Forge deployment 83681104 starts |
| 13:58:37 | deploy.sh starts; checkout already at `f495266`; 26,725 MB free; `npm ci` skipped |
| 13:58:37–~13:58:59 | `supabase db push`: **091, 092, 093 applied**, `Finished supabase db push.` |
| 13:59:00 | app daemon-746791 → **next-server 626892** |
| 13:59:03 | worker daemon-801730 → **pid 626977** |
| 13:59:05 | Forge deployment 83681104 finished |
| 13:59:41 | box `RELEASE.json`: source_ref `release-book009-010`, source_commit `0c41a4df…`, build_id `ByP1OESC_Ry3XVBnpk-wX` == `.next/BUILD_ID`; HEAD `f495266e`; only dirt ` M supabase/.temp/cli-latest` (pre-existing) |

## Migrations 091–093 result (read-only, Management API from the box, 13:59:41Z; `box-after-deploy.log`)
| check | result |
|---|---|
| ledger | `091` booking_terms_acceptance, `092` booking_guest_limits, `093` booking_room_search_path |
| `booking_requests` columns | 32 → 34: `terms_accepted_at` timestamptz NULL, `terms_text` text NULL |
| `booking_requests_terms_acceptance` | `CHECK (((terms_accepted_at IS NULL) AND (terms_text IS NULL)) OR ((terms_accepted_at IS NOT NULL) AND (terms_text IS NOT NULL) AND (char_length(terms_text) >= 1 AND <= 2002)))` |
| index | `booking_requests_restaurant_date_status_idx` present |
| `booking_stops` | exists, 9 columns, **RLS on, 0 policies**, 0 rows; `booking_stops_one UNIQUE NULLS NOT DISTINCT (restaurant_id, booking_date, scope, period_label, slot_time)`, scope/shape/label/slot/name CHECKs, FK to restaurants ON DELETE CASCADE; index `booking_stops_restaurant_date_idx` |
| `insert_booking_request_if_room(jsonb,text,time,time,int,int)` | plpgsql, **prosecdef true**, proconfig **`search_path=public, pg_temp`**; EXECUTE anon **false**, authenticated **false**, service_role true |
| `promote_agent_booking_with_room(uuid,text,text[],text,timestamptz,int,jsonb)` | plpgsql, **prosecdef true**, proconfig **`search_path=public, pg_temp`**; EXECUTE anon **false**, authenticated **false**, service_role true |
| `booking_room_refusal`, `booking_room_lock`, `booking_guest_counts` | not security definer, `search_path=public`; EXECUTE anon false, authenticated false, service_role true |
| booking_requests | **7 → 7**; ids identical to the backup (0 gone, 0 new), 0 status changes (confirmed 2, pending 5) |
| restaurants | 7; `booking_config` changed on **0** rows (hash equal to `restaurants-booking-config.json`); `bookingHours` set on 0 |
Box files (600): `after-catalog.json` (sha256 `ae9d98bb3819c7ad…`), `after-ids.json`. These are the only catalog
differences from the baseline, and the deploy made no data write. No WhatsApp message was sent.

## Post-Deploy Verification (read-only: no tenant login, no settings change, no booking written, no WhatsApp send)
| check | result |
|---|---|
| release | `git ls-remote origin refs/heads/release` = `f495266ea111145998d4a5d0df7c1187ea85573d` (was `c353dea9`) |
| box provenance | `RELEASE.json` source_commit `0c41a4df34e5da4d0ee9256e60fdaa22cdf7794c` == main merge commit; build_id == `.next/BUILD_ID` `ByP1OESC_Ry3XVBnpk-wX` |
| served build | `/login` **200**, embeds `ByP1OESC_Ry3XVBnpk-wX` once and `xk8QzLQHF8mIsyZ55BQSi` 0 times; public `https://app.ohmyclient.io/api/health` **200** |
| BOOK-010 in the bundle | `bookings-confirm-over-limit` in 1 file and `bookings-capacity-day-stop` in 1 file under `.next/static` (both absent from the previous main's `src`) |
| processes | app 3824835 → **626892** (started 13:59:00), worker 3824811 → **626977** (13:59:03): both changed |
| PAP availability | `GET https://app.ohmyclient.io/api/poppy/<omc demo public id>/availability?from=2026-11-22&days=3` from the Mac, 14:00:22Z: **HTTP 200** `application/json`, `dates` list[3], `interval_minutes`/`table_minutes`/`terms` null, `max_party_size` int: no 5xx, as expected with hours unset (`ac3-availability-probe.log`; the id is not recorded) |
| logs, 5 min after restart | 14:04:18Z (site command 14543197, `box-stability-5min.log`); pids unchanged, up 5m17s / 5m14s, `/api/health` 200. App after the banner: `✓ Ready in 506ms`, the known `next start`/standalone warning, **2** `[Kapso] Error listing templates` lines (known), **1** `[AgentBooking] rate limiter unavailable, allowing: Error` (known BOOK-OPS-1 line; 8 earlier occurrences in the log; it fires during the limiter's startup window, here most likely on the 14:00:22Z probe, which was allowed). Worker: `Workers started: … agent-reply`, then **1** `[sweepIntegrationQueues] pruneOrphanIntegrationEvents failed { error: '… (deliveries): Bad Request' }`, an existing line: 415 identical earlier occurrences, the last 3 on the previous build just before the restart (`box-log-history.log`). **No new error type.** |
| box after | MemAvailable 2,285 MB, swap 102 MB free, load 0.02, disk 26,724 MB free (14:04:18Z) |
| not run | the new settings, capacity block, stops and the diner slot form in the live app (needs a tenant login and a settings write); owner's live check on omc |

## Rollback (ready, NOT executed; ETR ≈ 3 min for code)
1. **Code** to the WONB-020 release (`c353dea9` = `main@660f82df`, BUILD_ID `xk8QzLQHF8mIsyZ55BQSi`). This is a
   force-push to `release` and **needs Xavier's OK**:
   ```
   # from any worktree of this repo (local refs are shared)
   rtk proxy git push --force origin release-backup-c353dea:refs/heads/release
   git ls-remote origin refs/heads/release      # must read c353dea911810fb79275c00bd4215d7399f0ab2c
   # Forge redeploys: RELEASE.json source_commit 660f82df, BUILD_ID xk8QzLQHF8mIsyZ55BQSi, both pids change, /api/health 200.
   ```
   If the local ref is gone, force-push by SHA `c353dea911810fb79275c00bd4215d7399f0ab2c`. deploy.sh's `db push`
   then finds nothing to apply, and 091–093 stay. The old code never selects the terms columns, never reads
   `booking_stops` and never calls the five functions, so they are inert under it. Stops and terms acceptances
   written after this release stay in the DB but have no effect.
2. **091–093 stay** unless the owner decides otherwise. Reverting them is a separate decision, not part of a code
   rollback, and the code rollback goes first because the new code uses these objects. The exact revert is one
   transaction through the Management API. Copy out first anything written after the release:
   `booking_stops` rows, and rows with `terms_accepted_at` set.
   ```sql
   BEGIN;
   -- 093 has no separate undo: dropping the functions removes its settings
   DROP FUNCTION IF EXISTS public.booking_guest_counts(uuid, date, date);
   DROP FUNCTION IF EXISTS public.promote_agent_booking_with_room(uuid, text, text[], text, timestamptz, int, jsonb);
   DROP FUNCTION IF EXISTS public.insert_booking_request_if_room(jsonb, text, time, time, int, int);
   DROP FUNCTION IF EXISTS public.booking_room_lock(uuid, date);
   DROP FUNCTION IF EXISTS public.booking_room_refusal(uuid, date, time, int, text, time, time, int, int);
   DROP INDEX IF EXISTS booking_requests_restaurant_date_status_idx;
   DROP TABLE IF EXISTS booking_stops;
   ALTER TABLE booking_requests DROP CONSTRAINT IF EXISTS booking_requests_terms_acceptance;
   ALTER TABLE booking_requests DROP COLUMN IF EXISTS terms_text;
   ALTER TABLE booking_requests DROP COLUMN IF EXISTS terms_accepted_at;
   DELETE FROM supabase_migrations.schema_migrations WHERE version IN ('091', '092', '093');
   COMMIT;
   ```
   - Only 093 has a lighter undo (its own rollback line):
     `ALTER FUNCTION … SET search_path = public` on the two SECURITY DEFINER functions. It weakens the hardening and
     is not recommended.
   - A full DB restore is the managed daily backup `2327131357` (2026-11-20T19:32Z) or newer. The row copies in
     `/home/forge/backups/2026-11-22-book-009-010/` cover booking_requests and restaurants.booking_config.

## Cleanup
| item | state |
|---|---|
| remote `release-book009-010` | deleted 2026-11-22 ~14:00:30Z; `ls-remote` empty |
| local branch `release-book009-010` | deleted (`git branch -D`) |
| remote `chore/release-book009-010` (PR #225 head) | left as GitHub keeps it; delete once the records PR merges |
| local ref `release-backup-c353dea` | kept as the rollback handle (not pushed) |
| `origin/release` `c353dea9` → `f495266e` | replaced (force-push by `release.sh`, by design) |
| box `/home/forge/rel-book009-tmp/` (q.py, q2.py; no secrets) | deleted 14:06:33Z (site command 14543239, `box-cleanup.log`) |
| box `/home/forge/backups/2026-11-22-book-009-010/` | kept (dir 700, files 600); delete once the release is accepted |

## Notes
- The session restarted between the merge (11-21 16:54Z) and the release (11-22 13:56Z). It wiped the session
  scratchpad, which held the first gate's logs and the local copies of the pre-flight and backup logs.
  - The pre-flight and backup logs were re-fetched from their Forge command outputs (14520228, 14520252), so they
    are the original 11-21 outputs.
  - The gate was re-run on the same tree.
  - Main's resume message asked for the ledger check, the backup sha256s and a fresh baseline if anything moved.
    All three are done above, and nothing had moved.
- Forge's `POST …/commands` answers 202 with an empty body. The command id comes from
  `GET …/commands?sort=-created_at`, matched on the command text with the trailing newline stripped (Forge strips
  it).
- The kanban file has 14 duplicate task ids (SEC-002, WAQ-001…013) on base, develop and main alike. This is
  pre-existing; the merge did not touch them.
