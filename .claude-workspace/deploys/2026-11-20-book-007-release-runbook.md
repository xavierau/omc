---
id: deploys/2026-11-20-book-007-release-runbook
type: deploy
author: dev
created: 2026-11-20
status: executed
supersedes: null
superseded_by: null
related: [kanban:BOOK-007, github:210, github:211, artifacts/2026-11-20-rel-book007-handoff, artifacts/2026-11-20-book-007-r1-handoff, threats/2026-11-20-book-007-008-member-bookings, deploys/2026-11-19-agent-003-release-runbook, deploys/2026-11-20-book-006-release-runbook]
---

# Deploy: BOOK-007 no-show marking with migration 087: `main` @ `23dc635f` to production

**Outcome: DEPLOYED 2026-11-20 04:28Z (12:28 HKT). Migration 087 was applied before the daemons restarted.** Prod
serves `main@23dc635f`, release **`ca44103a`**, BUILD_ID **`2X-ml2OJycTIYik4jAYvg`**. App next-server pid
**3573648**, worker pid **3573713** (`npm exec`). The post-deploy catalog is exactly what 087 defines, and no row has
status `no_show`. Every read-only check passes except one log line: after the restart the app logged
`[Kapso] Error listing templates: WhatsApp configuration not found` (2 lines by 04:32Z, 6 by 05:14Z). That line
is a **pre-existing** `console.warn` (6,694 earlier lines, including under the AGENT-004 and BOOK-006 builds) from a
file this release does not change. It is not the limiter line main ruled on, so AC-4 is recorded as a literal fail
pending main's ruling; see "Exception" below.

Stage: POC (the repo does not import `stages/mature.md`). Hosting: the existing Forge box; the `fly-deploy` and
Cloudflare rules do not apply. Go: Xavier, 2026-11-20 ("merge and release it"), relayed by main; it covers the
develop → main merge, applying 087 through deploy.sh's `supabase db push`, and release.sh's force-push of `release`.
Repo `xavierau/omc` is **public**: no tenant id, booking id, user id, email, phone number, message text or secret
appears below or in the evidence (`built_by`, the seeded admin email and its user id are redacted). All times UTC.

## Scope
- `main` before: **`99f81731`** (BOOK-006 release). `main` now: **`23dc635f`** = merge of release PR **#211**
  (develop `460d9490` → main), which brings:
  - `460d9490` BOOK-007 (PR #210 squash): staff mark a past confirmed booking as no-show and can undo it.
    Migration **087_booking_no_show** (additive): the status CHECK adds `no_show`; new columns `no_show_marked_by`
    uuid and `no_show_marked_at` timestamptz; `booking_requests_decision_consistent` adds `no_show` to the
    decided group; the new `booking_requests_no_show_marker` CHECK; and the RPC `mark_booking_no_show`
    (service_role only). The undo is a conditional UPDATE in the repository. No diner message.
  - `7bbe622f` BOOK-006 release docs (#209, workspace records only).
- Delta `99f81731..23dc635f`: the only migration is `087_booking_no_show.sql`. No change to `package.json`,
  `package-lock.json`, `scripts/`, `deploy.sh` or `.env.example`; no env var added. No cron route changed.
- Target: `https://app.ohmyclient.io`, Forge server 1149990 / site 3123752, checkout
  `/home/forge/app.ohmyclient.io` on `release`. Supabase prod `whatsapp-crm-pro` (`uzimqndenngebzgndlhd`).
- Previous prod: `main@99f81731`, release **`8de9aea6`**, BUILD_ID `e1I15X2aClu1mW4QksVz2`, app pid 3545420,
  worker pid 3545481.
- Executed from a fresh detached worktree `/Users/xavierau/Code/js/whatsapp-crm--release-book007` at `460d9490`,
  with `.env.local` and `.env.production.local` copied from the primary checkout (`cmp` identical, gitignored,
  never committed). The primary checkout and every other worktree (including `--book-007`) were not touched.

## Pre-Flight
- [x] **Range** (04:0xZ): `origin/develop` = `460d9490`; `origin/main..origin/develop` = `7bbe622f`, `460d9490` only.
- [x] **Gate** on `460d9490` under the heavy lock, 04:09:37–04:13:01Z. Exit codes read from files
      (`artifacts/evidence/2026-11-20-book-007-release/ac-gate-*`):
  - `npm ci` exit 0 (fresh tree, no `node_modules`).
  - `tsc --noEmit` exit 0 (empty log).
  - `vitest run` exit 0: **669 files passed / 14 skipped, 7,658 tests passed, 127 skipped, 2 todo**.
  - The released tree (`23dc635f`) is the same tree as `460d9490` (`75c2d837…`).
- [x] **Box** (04:10:17Z, Forge site command 14470810, `box-preflight.log`): HEAD `8de9aea6`, BUILD_ID
      `e1I15X2aClu1mW4QksVz2`, RELEASE.json source_commit `99f81731`; app 3545420 and worker 3545481 up 53m. Disk
      26,912 MB free, MemAvailable 2,404 MB, swap 33 MB free, load 0.26. The site `.env` has a non-empty
      `SUPABASE_ACCESS_TOKEN` and names project `uzimqndenngebzgndlhd`.
- [x] **Backup (04:11:09–04:11:11Z), before the release PR existed** (Forge site command 14470823,
      `box-backup.log`). The helper `/home/forge/rel-book007-tmp/q.py` called the Supabase Management API from the
      box with the token read in-process from the site `.env`, never printed. Box dir
      `/home/forge/backups/2026-11-20-book-007/` (700, files 600):
      | file | content | sha256 |
      |---|---|---|
      | `managed-backups.json` | backup list: 7 dailies, WAL-G on, PITR off; newest **2317028887 COMPLETED 2026-11-19T19:32:05Z** | `aba7fa74236c3bc9f6d890ba483a88f4b48eb558b4d6e1957d8793372ac8fd85` |
      | `booking_requests.json` | full rows, 5 | `ae5d35ecf46db8b4c08b4d1f2584106fd842a4c8818a75edbe66cd97c68cb3a8` |
      | `baseline-catalog.json` | catalog + counts | `8bdbc8d5759eefd32652cc6bcfd5ebf434728359f4353629b817af811ffe4fef` |
      Baseline catalog:
      - Ledger tail 082–**086**, no 087.
      - Status CHECK `unverified, pending, confirmed, declined, cancelled`, with no `no_show`.
      - `booking_requests_decision_consistent` is the 085 rule; `booking_requests_no_show_marker` is absent.
      - 30 columns, no `no_show_marked_by` / `no_show_marked_at`; `mark_booking_no_show` is absent.
      - Counts: booking_requests **5** (confirmed 1, unverified 1, pending 3), restaurants 7, members 4,227.
- [x] **Restore point.** `origin/release` (`8de9aea6`) fetched as the local ref **`release-backup-8de9aea`** (not
      pushed).

## Runbook (as executed)
```
cd /Users/xavierau/Code/js/whatsapp-crm
rtk proxy git fetch origin
rtk proxy git worktree add --detach ../whatsapp-crm--release-book007 460d9490
cp .env.local .env.production.local ../whatsapp-crm--release-book007/                    # cmp identical
rtk proxy git fetch origin refs/heads/release:refs/heads/release-backup-8de9aea            # 8de9aea6
cd ../whatsapp-crm--release-book007
resource-lock.py heavy -- bash -c 'npm ci; npx tsc --noEmit; npx vitest run'               # 04:09:37–04:13:01Z, all exit 0
# box pre-flight 14470810 (read-only); backup + baseline catalog 14470823 (04:11:09Z)
rtk proxy git merge-tree --write-tree origin/main origin/develop                          # exit 0, tree 75c2d837 == develop
gh pr create --base main --head develop                                                   # #211 04:13:23Z, MERGEABLE/CLEAN, CodeRabbit pass
gh pr merge 211 --merge --match-head-commit 460d9490…                                     # 04:23:17Z → 23dc635f
rtk proxy git checkout -B rel-book007 23dc635f
timeout 120 rtk proxy git push origin rel-book007:refs/heads/rel-book007                   # ls-remote 23dc635f ✓
SOURCE_REF=rel-book007 resource-lock.py heavy -- bash scripts/release.sh                   # exit 0, 04:23:40–04:27:38Z
git ls-remote origin refs/heads/release                                                     # ca44103a ✓ (was 8de9aea6)
# Forge auto-deploy 83523830: deploy.sh → supabase db push (087) → seed → restart app + worker
# post-deploy box + catalog 14471027; status-move checks 14471032, 14471038; stability 14471080, 14471088, 14471702
timeout 120 rtk proxy git push origin --delete rel-book007                                  # ls-remote empty ✓
rm -rf /home/forge/rel-book007-tmp                                                          # site command 14471091
```
release.sh tail (`release-sh.log`; the bundle was built at 04:25:40Z):
```
→   building rel-book007 @ 23dc635
→   node v22.21.1
→   BUILD_ID 2X-ml2OJycTIYik4jAYvg
→ Scanning bundle for inlined credentials
→   clean
 + 8de9aea6...ca44103a ca44103ae0efb401ead3ce5b779c66ba6b5d277b -> release (forced update)
✓ Released rel-book007 @ 23dc635 → origin/release (ca44103)
```

**Migration ordering, proven from the Forge deployment log** (`GET …/deployments/83523830/log`, redacted copy
`forge-deploy-83523830.log`):
```
Fri Nov 20 04:28:04 UTC 2026
  already at ca44103
  26906MB free (minimum 1500MB)
  BUILD_ID 2X-ml2OJycTIYik4jAYvg
  from rel-book007 @ 23dc635 — Merge pull request #211 from xavierau/develop
  lockfile unchanged (5b141452304d) — node_modules is current, skipping npm ci
→ Applying pending migrations
 • 087_booking_no_show.sql
Applying migration 087_booking_no_show.sql...
NOTICE (00000): constraint "booking_requests_no_show_marker" of relation "booking_requests" does not exist, skipping
Finished supabase db push.
→ Seeding platform admin (idempotent)
→ Restarting daemons
  restarting app → daemon-746791 … app is RUNNING
  restarting worker → daemon-801730 … worker is RUNNING
✓ Deploy complete
```
deploy.sh runs under `set -euo pipefail`, so `Finished supabase db push.` comes before both restarts. The NOTICE is
087's own `DROP CONSTRAINT IF EXISTS` on a constraint that did not exist yet, which is expected. The new app process
started at 04:28:32Z and the worker at 04:28:37Z, inside the deployment window 04:27:38–04:28:39Z.

## Deploy facts
| time (UTC) | event |
|---|---|
| 04:23:17 | main merge commit `23dc635f` (PR #211) |
| 04:25:40 | bundle built on the Mac (node v22.21.1) |
| 04:27:38 | `release` force-pushed → `ca44103a`; Forge deployment 83523830 starts |
| 04:28:04 | deploy.sh starts; checkout already at `ca44103`; 26,906 MB free; `npm ci` skipped |
| 04:28:04–~04:28:30 | `supabase db push`: **087 applied**, `Finished supabase db push.` |
| 04:28:32 | app daemon-746791 → **next-server 3573648** (`✓ Ready in 796ms`) |
| 04:28:37 | worker daemon-801730 → **pid 3573713**; `Workers started: campaign, event-dispatch, receipt, email-send, integration-inbound, integration-outbound, agent-reply` |
| 04:28:39 | Forge deployment 83523830 finished |
| 04:29:02 | box `RELEASE.json`: source_ref `rel-book007`, source_commit `23dc635f…`, build_id `2X-ml2OJycTIYik4jAYvg` == `.next/BUILD_ID`; HEAD `ca44103a`; only dirt ` M supabase/.temp/cli-latest` (pre-existing) |

## Migration 087 result (read-only, Management API from the box, 04:29Z; `ac5-post-catalog.log`)
| check | result |
|---|---|
| ledger | `085`, `086`, **`087` (booking_no_show)** |
| status CHECK | `status IN ('unverified','pending','confirmed','declined','cancelled','no_show')` |
| new columns | `no_show_marked_by` uuid NULL, `no_show_marked_at` timestamptz NULL (32 columns, was 30) |
| decision constraint | `(unverified/pending AND decided_at NULL) OR (confirmed/declined/no_show AND decided_at NOT NULL) OR (cancelled AND cancelled_at NOT NULL)`, as in 087 |
| no-show marker | `booking_requests_no_show_marker`: `(status = 'no_show') = (no_show_marked_at IS NOT NULL)` |
| cancel marker | `booking_requests_cancel_marker` unchanged |
| function | `mark_booking_no_show(uuid,uuid,uuid,timestamptz,date,time)` RETURNS SETOF booking_requests, LANGUAGE sql; EXECUTE anon **false**, authenticated **false**, service_role **true** |
| row count | booking_requests **5**, the same as the 04:11Z baseline; restaurants 7, members 4,227 unchanged |
| no_show | **0** rows with status `no_show`; 0 rows with either marker column set |
Box files: `after-catalog.json` (sha256 `8951811175b7505a…`), `after-status-move.json` (`e86557fb4b002c8b…`),
`after-ids.json` (`0ba430520c902eeb…`), all 600.

**Status mix vs baseline:** the baseline had 1 confirmed, 1 unverified and 3 pending; after the deploy, 1 confirmed
and 4 pending. Ids were compared on the box and not printed:
- **Gone (1):** an `unverified` agent booking created 03:11Z whose code expired 03:41Z. The booking-reminders cron's
  `purgeUnverifiedBookings` (BOOK-003 R41) deletes such rows.
- **New (1):** a `pending` agent booking created 04:24:04Z, under the old build, before the deploy.
- **Kept (4):** same status as at baseline.
So 087 changed no row, and the equal count is one purge plus one new booking, not "nothing happened".

## Post-Deploy Verification (read-only: no tenant login, no WhatsApp send, no DB write)
| check | result |
|---|---|
| release | `git ls-remote origin refs/heads/release` = `ca44103ae0efb401ead3ce5b779c66ba6b5d277b` (was `8de9aea6`) |
| box provenance | `RELEASE.json` source_commit `23dc635f00bfd2b807842a7794acc99e04dbb0aa` == main merge commit; build_id == `.next/BUILD_ID` |
| served build | `/login` **200**, embeds `2X-ml2OJycTIYik4jAYvg` once and the old BUILD_ID 0 times; `/api/health` **200** (`box-after-deploy.log`) |
| processes | app 3545420 → **3573648**, worker 3545481 → **3573713**: both changed; the same pids at 04:32:06Z (up 3m33s / 3m28s) and at 05:14:37Z (up 46m) |
| worker | `[AgentReplyQueue] Worker started`, `Workers started: … agent-reply`; after that, only one info line `agent.purged {deleted 0, silences 0, failedTenants 0}` (04:51:56Z); 0 error/warn |
| app log, ≥3 min after restart | after the `▲ Next.js` banner: Local/Network, `✓ Ready`, `Running next.config.ts`, the known `"next start" does not work with "output: standalone"` warning, and **2 × `[Kapso] Error listing templates: WhatsApp configuration not found`** (6 by 05:14Z), see Exception. **0** limiter lines (`[AgentBooking]/[Booking] rate limiter unavailable`) |
| box after | MemAvailable 2,416 MB, swap 63 MB free, load 0.59, disk 26,905 MB free |
| not run | the no-show buttons themselves (needs a tenant login and a DB write): the owner's live check on omc's bookings page |

### Exception: `[Kapso] Error listing templates: WhatsApp configuration not found` (not a BOOK-007 regression)
- `box-stability.log` (Forge site command 14471088): the app log holds **6,694** such lines.
  - Lines 22207–22212 were logged under the AGENT-004 build (banner 22200).
  - Lines 22224–22231 were logged under the BOOK-006 build (banner 22217).
  - Lines 22242–22243 and later are under this build (banner 22236).
- Source: `console.warn('[Kapso] Error listing templates:', …)` in `src/infrastructure/kapso/template-client.ts:118`,
  which is unchanged in `99f81731..23dc635f`. It is a warn whose text contains "Error".
- What triggers it on a schedule is (unconfirmed, looked in: app log timing only). It is probably the template list
  or sync for a tenant with no WhatsApp configuration.
- BOOK-006's 3-minute check saw none only because it ran before the next batch.
- Effect: none on bookings. Brief AC-4 allows only the limiter line, so this is a literal fail for main to rule on.
  No rollback is proposed.

## Rollback (ready, NOT executed; ETR ≈ 3 min)
1. **Code** to the BOOK-006 release (`8de9aea6` = `main@99f81731`, BUILD_ID `e1I15X2aClu1mW4QksVz2`). This is a
   force-push to `release` and **needs Xavier's OK**:
   ```
   # from any worktree of this repo (local refs are shared)
   rtk proxy git push --force origin release-backup-8de9aea:refs/heads/release
   git ls-remote origin refs/heads/release      # must read 8de9aea69fc4e3910bd8ad0755cdcefb718329d6
   # Forge redeploys: RELEASE.json source_commit 99f81731, BUILD_ID e1I15X2aClu1mW4QksVz2, both pids change, /api/health 200.
   ```
   If the local ref is gone, force-push by SHA `8de9aea69fc4e3910bd8ad0755cdcefb718329d6`. deploy.sh's
   `db push` finds nothing to apply, and 087 stays.
   - The old code never writes `no_show` and ignores the two new columns.
   - A row already marked `no_show` would show in the old staff UI only as the raw status, with no undo.
   - Undo such rows before the code rollback if that matters.
2. **087 is additive and stays** unless the owner decides otherwise (a separate decision, not part of a code
   rollback). Exact revert, as one transaction through the Management API, **only after every `no_show` row is set
   back to `confirmed`** (with both marker columns NULL):
   ```sql
   BEGIN;
   UPDATE booking_requests SET status = 'confirmed', no_show_marked_by = NULL, no_show_marked_at = NULL WHERE status = 'no_show';
   DROP FUNCTION IF EXISTS public.mark_booking_no_show(uuid, uuid, uuid, timestamptz, date, time);
   ALTER TABLE booking_requests DROP CONSTRAINT IF EXISTS booking_requests_no_show_marker;
   ALTER TABLE booking_requests DROP CONSTRAINT IF EXISTS booking_requests_decision_consistent;
   ALTER TABLE booking_requests ADD CONSTRAINT booking_requests_decision_consistent CHECK (
     (status IN ('unverified','pending') AND decided_at IS NULL)
     OR (status IN ('confirmed','declined') AND decided_at IS NOT NULL)
     OR (status = 'cancelled' AND cancelled_at IS NOT NULL));
   ALTER TABLE booking_requests DROP CONSTRAINT IF EXISTS booking_requests_status_check;
   ALTER TABLE booking_requests ADD CONSTRAINT booking_requests_status_check
     CHECK (status IN ('unverified','pending','confirmed','declined','cancelled'));
   ALTER TABLE booking_requests DROP COLUMN IF EXISTS no_show_marked_at;
   ALTER TABLE booking_requests DROP COLUMN IF EXISTS no_show_marked_by;
   DELETE FROM supabase_migrations.schema_migrations WHERE version = '087';
   COMMIT;
   ```
   The 085 definitions restored above come from `baseline-catalog.json` on the box. The pre-deploy rows are in
   `booking_requests.json`. Run the code rollback first, or the running code would hit the old CHECK.

## Cleanup
| item | state |
|---|---|
| remote `rel-book007` | deleted 04:33Z; `ls-remote origin refs/heads/rel-book007` empty (re-checked 05:14Z) |
| local branch `rel-book007` | deleted (`git branch -D`) |
| local ref `release-backup-8de9aea` | kept as the rollback handle (not pushed) |
| `origin/release` `8de9aea6` → `ca44103a` | replaced (force-push by `release.sh`, by design) |
| box `/home/forge/rel-book007-tmp/` (query helper + SQL; no secrets) | deleted 04:33Z (site command 14471091) |
| box `/home/forge/backups/2026-11-20-book-007/` | kept (6 files, 600); delete once the release is accepted |
| worktree `--release-book007` | removed after the records PR was pushed (see handoff) |
| worktree `--book-007` | untouched (per brief) |
