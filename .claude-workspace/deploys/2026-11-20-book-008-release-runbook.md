---
id: deploys/2026-11-20-book-008-release-runbook
type: deploy
author: dev
created: 2026-11-20
status: executed
supersedes: null
superseded_by: null
related: [kanban:BOOK-008, kanban:BOOK-OPS-1, github:214, github:217, artifacts/2026-11-20-rel-book008-handoff, artifacts/2026-11-20-book-008-r1-handoff, threats/2026-11-20-book-007-008-member-bookings, deploys/2026-11-20-book-007-release-runbook]
---

# Deploy: BOOK-008 member ↔ booking linking with migration 088: `main` @ `1f2b9eb4` to production

**Outcome: DEPLOYED 2026-11-20 08:19Z (16:19 HKT). Migration 088 was applied before the daemons restarted.** Prod
serves `main@1f2b9eb4`, release **`d74942c1`**, BUILD_ID **`Dy3BMrmauUbUY9gIzFdVI`**. App next-server pid
**3661017**, worker pid **3661081** (`npm exec`). The post-deploy catalog is exactly what 088 defines. 088's own
backfill linked the one member-less booking (member_id NULL 1 → 0). The single post-deploy re-run of that UPDATE
touched **0 rows**. Every read-only check passes. Over 5 minutes after the restart the app and worker logged no error
line: no Kapso line and no limiter line.

Stage: POC (the repo does not import `stages/mature.md`). Hosting: the existing Forge box; the `fly-deploy` and
Cloudflare rules do not apply. Go: Xavier, 2026-11-20 ("1y"), relayed by main. It covers the develop → main merge,
applying 088 through deploy.sh's `supabase db push`, release.sh's force-push of `release`, and one post-deploy re-run
of 088's backfill UPDATE. Repo `xavierau/omc` is **public**: no tenant id, booking id, member id, user id, email,
phone number, message text or secret appears below or in the evidence (`built_by`, the seeded admin email and its
user id are redacted). All times UTC.

## Scope
- `main` before: **`23dc635f`** (BOOK-007 release). `main` now: **`1f2b9eb4`** = merge of release PR **#217**
  (develop `e751ee5a` → main). It brings:
  - `e751ee5a` BOOK-008 (PR #214 squash): staff see each member's bookings and stats on the member panel, open the
    member from a booking, and link, relink or unlink by hand. Migration **088_booking_member_backfill** does five
    things:
    - `events_type_check` adds `booking.member_relinked`: 081's 20 types plus 1.
    - It adds the partial index `booking_requests_restaurant_member_date_idx`.
    - It adds two RPCs, `relink_booking_member` and `member_booking_stats`, both service_role only.
    - The trigger `trg_members_link_bookings` (AFTER INSERT on members) runs `link_member_bookings()`.
    - A one-off, idempotent backfill sets `booking_requests.member_id` by same-restaurant phone, skipping
      unverified rows.
  - `981eb12e` AGENT-OPS-1 docs (#215) and `9f8c7d22` BOOK-007 release docs (#213): workspace records only.
- Delta `23dc635f..1f2b9eb4`: the only migration is `088_booking_member_backfill.sql`. Nothing else changes in the
  release plumbing: no `package.json`, `package-lock.json`, `scripts/`, `deploy.sh` or `.env.example` change, no new
  env var, and no cron route change.
- Target: `https://app.ohmyclient.io`, Forge server 1149990 / site 3123752, checkout
  `/home/forge/app.ohmyclient.io` on `release`. Supabase prod `whatsapp-crm-pro` (`uzimqndenngebzgndlhd`).
- Previous prod: `main@23dc635f`, release **`ca44103a`**, BUILD_ID `2X-ml2OJycTIYik4jAYvg`, app pid 3573648,
  worker pid 3573713.
- Executed from a fresh detached worktree `/Users/xavierau/Code/js/whatsapp-crm--release-book008` at `e751ee5a`.
  `.env.local` and `.env.production.local` were copied from the primary checkout (`cmp` identical, gitignored,
  never committed). The primary checkout and the other worktrees were not touched.
- The session broke between the PR opening (06:07Z) and the merge (08:14Z). Main re-checked the refs and the box at
  resume, and nothing had moved. A read-only pre-deploy snapshot taken at 08:14:58Z is identical to the 06:06Z
  baseline (same sha256).

## Pre-Flight
- [x] **Range** (06:04Z, re-checked 06:07Z and 08:14Z): `origin/develop` = `e751ee5a`;
      `origin/main..origin/develop` = `9f8c7d22`, `981eb12e`, `e751ee5a` only.
- [x] **Gate** on `e751ee5a` under the heavy lock, 06:04:04–06:06:40Z. Exit codes are read from files
      (`artifacts/evidence/2026-11-20-book-008-release/ac-gate-*`):
  - `npm ci` exit 0 (fresh tree).
  - `tsc --noEmit` exit 0 (empty log).
  - `vitest run` exit 0: **678 files passed / 14 skipped, 7,761 tests passed, 127 skipped, 2 todo**.
- [x] **Box** (06:04:26Z, Forge site command 14472599, `box-preflight.log`):
  - Release state: HEAD `ca44103a`, BUILD_ID `2X-ml2OJycTIYik4jAYvg`, RELEASE.json source_commit `23dc635f`.
  - Processes: app 3573648 and worker 3573713, up 1h36m.
  - Resources: disk 26,900 MB free, MemAvailable 2,328 MB, swap 52 MB free, load 0.17.
  - The site `.env` has a non-empty `SUPABASE_ACCESS_TOKEN` and names project `uzimqndenngebzgndlhd`.
- [x] **Events type pre-check** (06:05:48Z, site command 14472614, `ac2-events-precheck.log`): **PASS**.
  - Prod `select distinct type from events` returns 5 types: campaign, consent_imported, join, redeem, whatsapp_error.
    All 5 are in 088's 21-type list, so none is missing.
  - The live `events_type_check` lists 081's 20 types. 088's list equals it plus `booking.member_relinked`, so the
    ADD CONSTRAINT cannot fail on existing rows.
- [x] **Backup (06:06:38–06:06:42Z), before release PR #217 existed** (opened 06:07:25Z; site command 14472623,
      `ac2-box-backup.log`). The helper `/home/forge/rel-book008-tmp/q.py` called the Supabase Management API from
      the box. It read the token in-process from the site `.env` and never printed it. Box dir
      `/home/forge/backups/2026-11-20-book-008/` (700, files 600):
      | file | content | sha256 |
      |---|---|---|
      | `managed-backups.json` | backup list: 7 dailies, WAL-G on, PITR off; newest **2317028887 COMPLETED 2026-11-19T19:32:05Z** | `b9e8ba4d132a58befe2d6101ddf19917c17b14189579146fa09d109963e7c845` |
      | `booking_requests.json` | full rows, 5 | `6f8235dff32a55e93b83586ee50955e0e46b8a4d71a0d6279db0e4c0ec5fd5ee` |
      | `members.json` | `id, restaurant_id, phone` only, 4,229 rows | `f6d0b9c5b2bc35da107fae349924b1320c4d935136f4445ef28a4cbe8678266d` |
      | `baseline-catalog.json` | catalog + counts | `0e359546756fcd8b87002aea5dc60bfd774f405a69c31235cfd17b924028c32e` |
      | `baseline-ids.json` | booking id, status, member_id-null flag | `4d3b097d6790abc4eab3a7d53a44f02ff6d6b1c755b1d9ab0334ee9509cc82a4` |
      Baseline catalog:
      - Ledger tail 084–**087**, with no 088.
      - `events_type_check` holds 081's 20 types and no `booking.member_relinked`.
      - The three functions `relink_booking_member`, `member_booking_stats` and `link_member_bookings` are absent.
      - On `members`, `trg_members_link_bookings` is absent; the only trigger is `trg_member_updated_outbox`.
      - The index `booking_requests_restaurant_member_date_idx` is absent.
      - Counts:
        - booking_requests **5** (confirmed 1, pending 4); member_id NULL **1** (pending 1).
        - Rows 088's backfill would match: **1**.
        - members 4,229, restaurants 7, events of type `booking.member_relinked`: 0.
- [x] **Pre-deploy snapshot** (08:14:58Z, site command 14475583, `box-predeploy.log`), read-only, taken after the
      session break:
  - `booking_requests-predeploy.json` (sha256 `6f8235df…`) and `predeploy-catalog.json` (`0e359546…`) both equal
    the 06:06Z files byte for byte.
  - `predeploy-ids.json` is unchanged (0 gone, 0 new, 0 moved).
- [x] **Restore point.** `origin/release` (`ca44103a`) fetched as the local ref **`release-backup-ca44103`** (not
      pushed).

## Runbook (as executed)
```
cd /Users/xavierau/Code/js/whatsapp-crm
rtk proxy git fetch origin
rtk proxy git worktree add --detach ../whatsapp-crm--release-book008 e751ee5a
cp .env.local .env.production.local ../whatsapp-crm--release-book008/                      # cmp identical
rtk proxy git fetch origin refs/heads/release:refs/heads/release-backup-ca44103              # ca44103a
cd ../whatsapp-crm--release-book008
resource-lock.py heavy -- bash -c 'npm ci; npx tsc --noEmit; npx vitest run'                 # 06:04:04–06:06:40Z, all exit 0
# box pre-flight 14472599 (read-only); events pre-check 14472614 (PASS); backup + baseline catalog 14472623 (06:06:38Z)
rtk proxy git merge-tree --write-tree origin/main origin/develop                            # exit 0, tree 018355e2 == develop
gh pr create --base main --head develop                                                     # #217 06:07:25Z, MERGEABLE/CLEAN, CodeRabbit pass
# (session break; main re-checked refs and box at resume)
gh pr merge 217 --merge --match-head-commit e751ee5a…                                       # 08:14:39Z → 1f2b9eb4
# read-only pre-deploy snapshot 14475583 (08:14:58Z): identical to baseline; backfill dry count 1
rtk proxy git checkout -B rel-book008 1f2b9eb4
timeout 120 rtk proxy git push origin rel-book008:refs/heads/rel-book008                     # ls-remote 1f2b9eb4 ✓
SOURCE_REF=rel-book008 resource-lock.py heavy -- bash scripts/release.sh                     # exit 0, 08:15:21–08:19:08Z
git ls-remote origin refs/heads/release                                                       # d74942c1 ✓ (was ca44103a)
# Forge auto-deploy 83534624: deploy.sh → supabase db push (088) → seed → restart app + worker
# post-deploy box 14475768; catalog 14475786; backfill re-run 14475841; stability 14475909 (08:25:04Z)
timeout 120 rtk proxy git push origin --delete rel-book008                                    # ls-remote empty ✓ (08:23Z)
rm -rf /home/forge/rel-book008-tmp                                                            # site commands 14475923, 14475932
```
release.sh tail (`release-sh.log`; the bundle was built at 08:17:09Z):
```
→   building rel-book008 @ 1f2b9eb
→   node v22.21.1
→   BUILD_ID Dy3BMrmauUbUY9gIzFdVI
→ Scanning bundle for inlined credentials
→   clean
 + ca44103a...d74942c1 d74942c119e55b17bfec0961c8a319bd6e30faad -> release (forced update)
✓ Released rel-book008 @ 1f2b9eb → origin/release (d74942c)
```

**Migration ordering, proven from the Forge deployment log** (`GET …/deployments/83534624/log`, redacted copy
`forge-deploy-83534624.log`):
```
Fri Nov 20 08:19:33 UTC 2026
  already at d74942c
  27031MB free (minimum 1500MB)
  BUILD_ID Dy3BMrmauUbUY9gIzFdVI
  from rel-book008 @ 1f2b9eb — Merge pull request #217 from xavierau/develop
  lockfile unchanged (5b141452304d) — node_modules is current, skipping npm ci
→ Applying pending migrations
 • 088_booking_member_backfill.sql
Applying migration 088_booking_member_backfill.sql...
NOTICE (00000): trigger "trg_members_link_bookings" for relation "members" does not exist, skipping
Finished supabase db push.
→ Seeding platform admin (idempotent)
→ Restarting daemons
  restarting app → daemon-746791 … app is RUNNING
  restarting worker → daemon-801730 … worker is RUNNING
✓ Deploy complete
```
deploy.sh runs under `set -euo pipefail`, so `Finished supabase db push.` comes before both restarts. The NOTICE is
088's own `DROP TRIGGER IF EXISTS` for a trigger that did not exist yet, which is expected. The new app process
started at 08:19:51Z and the worker at 08:19:56Z, inside the deployment window 08:19:04–08:19:59Z.

## Deploy facts
| time (UTC) | event |
|---|---|
| 08:14:39 | main merge commit `1f2b9eb4` (PR #217) |
| 08:17:09 | bundle built on the Mac (node v22.21.1) |
| 08:19:04 | `release` force-pushed → `d74942c1`; Forge deployment 83534624 starts |
| 08:19:33 | deploy.sh starts; checkout already at `d74942c`; 27,031 MB free; `npm ci` skipped |
| 08:19:33–~08:19:50 | `supabase db push`: **088 applied**, `Finished supabase db push.` |
| 08:19:51 | app daemon-746791 → **next-server 3661017** (`✓ Ready in 428ms`) |
| 08:19:56 | worker daemon-801730 → **pid 3661081**; `Workers started: campaign, event-dispatch, receipt, email-send, integration-inbound, integration-outbound, agent-reply` |
| 08:19:59 | Forge deployment 83534624 finished |
| 08:20:24 | box `RELEASE.json`: source_ref `rel-book008`, source_commit `1f2b9eb4…`, build_id `Dy3BMrmauUbUY9gIzFdVI` == `.next/BUILD_ID`; HEAD `d74942c1`; only dirt ` M supabase/.temp/cli-latest` (pre-existing) |
| 08:22:34–40 | backfill re-run (verbatim 088 UPDATE, once): 0 rows |

## Migration 088 result (read-only, Management API from the box, 08:20:42Z; `ac5-post-catalog.log`)
| check | result |
|---|---|
| ledger | `086`, `087`, **`088` (booking_member_backfill)** |
| `events_type_check` | 081's 20 types + **`booking.member_relinked`** (21) |
| `relink_booking_member(uuid,uuid,uuid,uuid,uuid)` | sql, volatile, not security definer; EXECUTE anon **false**, authenticated **false**, service_role **true** |
| `member_booking_stats(uuid,uuid,date,time)` | sql, STABLE, not security definer; EXECUTE anon **false**, authenticated **false**, service_role **true** |
| `link_member_bookings()` | plpgsql trigger function, not security definer; EXECUTE anon **false**, authenticated **false**; service_role true through default privileges (088 grants it nothing; a trigger function cannot be called directly) |
| trigger | `CREATE TRIGGER trg_members_link_bookings AFTER INSERT ON public.members FOR EACH ROW EXECUTE FUNCTION link_member_bookings()`; `trg_member_updated_outbox` unchanged |
| index | `booking_requests_restaurant_member_date_idx` btree `(restaurant_id, member_id, booking_date DESC, booking_time DESC) WHERE member_id IS NOT NULL` |
| booking_requests | **5**, the same as at 06:06Z and 08:14Z; ids identical (0 gone, 0 new); status mix unchanged (confirmed 1, pending 4); **1 kept row member_id NULL → linked** (088's backfill); 0 linked → NULL |
| member_id NULL | baseline 06:06Z **1** → pre-deploy 08:14Z **1** → after 088 08:20Z **0** → after re-run 08:22Z **0** |
| other counts | members 4,229, restaurants 7 unchanged; `booking.member_relinked` events 0 |
Box files (600): `after-deploy-catalog.json` (sha256 `c98b201a0e059c0d…`), `after-deploy-ids.json` (`43dd8213678f2109…`).

**No new diner traffic during the release window:** the booking ids are the same set at 06:06, 08:14 and 08:20Z.
So the total is equal because nothing came in. It does not hide a purge offset by a new booking.

## Post-deploy backfill re-run (the one write besides the deploy; `ac5-backfill-rerun.log`, site command 14475841)
- Statement: the last statement of `088_booking_member_backfill.sql`, extracted programmatically from the file at
  `e751ee5a` and copied verbatim (sha256 `c50d72fd9536f4b5…` on the Mac and on the box):
  ```sql
  UPDATE booking_requests b
     SET member_id = m.id
    FROM members m
   WHERE b.member_id IS NULL
     AND b.status <> 'unverified'
     AND m.restaurant_id = b.restaurant_id
     AND m.phone = b.phone;
  ```
- Dry count first: a SELECT with the same join and WHERE returned **0** at 08:20:42Z, and again at 08:22:34Z right
  before the UPDATE. Both are within the 50-row limit.
- Run once through `POST /database/query` (HTTP 201, response `[]`; the API returns no row count for an UPDATE
  without RETURNING).
- **Rows affected: 0**, measured as the matching count before (0) minus after (0). member_id NULL went 0 → 0.

## Post-Deploy Verification (read-only apart from the re-run: no tenant login, no WhatsApp send, no relink, no member insert)
| check | result |
|---|---|
| release | `git ls-remote origin refs/heads/release` = `d74942c119e55b17bfec0961c8a319bd6e30faad` (was `ca44103a`) |
| box provenance | `RELEASE.json` source_commit `1f2b9eb44ad665ae4e0818cb6b66235d0a96f8b4` == main merge commit; build_id == `.next/BUILD_ID` `Dy3BMrmauUbUY9gIzFdVI` |
| served build | `/login` **200**, embeds `Dy3BMrmauUbUY9gIzFdVI` once and `2X-ml2OJycTIYik4jAYvg` 0 times; `/api/health` **200** (`box-after-deploy.log`, again in `box-stability.log`) |
| processes | app 3573648 → **3661017**, worker 3573713 → **3661081**: both changed; the same pids at 08:25:04Z (up 5m12s / 5m07s) |
| worker | `[AgentReplyQueue] Worker started`, `Workers started: … agent-reply`; 0 lines after; 0 error/warn |
| app log, 5 min after restart | after the `▲ Next.js` banner: Local/Network, `✓ Ready`, `Running next.config.ts`, the known `"next start" does not work with "output: standalone"` warning; **0** `[Kapso] Error listing templates` lines, **0** `[AgentBooking]/[Booking] rate limiter unavailable` lines, **0** other error lines. Known lines counted per main's ruling: Kapso 0, limiter 0 (6,724 Kapso lines in the whole log, all from earlier builds) |
| box after | MemAvailable 2,389 MB, swap 59 MB free, load 0.07, disk 27,030 MB free |
| not run | the member panel's bookings/stats and the manual relink in the live app (needs a tenant login; a relink is a DB write): the owner's live check on omc |

## Rollback (ready, NOT executed; ETR ≈ 3 min for code)
1. **Code** to the BOOK-007 release (`ca44103a` = `main@23dc635f`, BUILD_ID `2X-ml2OJycTIYik4jAYvg`). This is a
   force-push to `release` and **needs Xavier's OK**:
   ```
   # from any worktree of this repo (local refs are shared)
   rtk proxy git push --force origin release-backup-ca44103:refs/heads/release
   git ls-remote origin refs/heads/release      # must read ca44103ae0efb401ead3ce5b779c66ba6b5d277b
   # Forge redeploys: RELEASE.json source_commit 23dc635f, BUILD_ID 2X-ml2OJycTIYik4jAYvg, both pids change, /api/health 200.
   ```
   If the local ref is gone, force-push by SHA `ca44103ae0efb401ead3ce5b779c66ba6b5d277b`. deploy.sh's `db push`
   then finds nothing to apply, and 088 stays.
   - The old code never calls the two RPCs.
   - The trigger keeps linking a new member's member-less bookings. This is harmless: the old code already links at
     booking creation by the same rule.
   - The old dashboard feed does not filter `booking.member_relinked` (BOOK-008 r1 F4 added that filter). Any manual
     relink rows written before the rollback would therefore show in the old feed.
2. **088 stays** unless the owner decides otherwise. Reverting it is a separate decision, not part of a code
   rollback. Run the code rollback first, because the new code calls the RPCs. The exact revert is one transaction
   through the Management API, and it drops the trigger first so that no member insert links anything mid-revert:
   ```sql
   BEGIN;
   DROP TRIGGER IF EXISTS trg_members_link_bookings ON members;
   DROP FUNCTION IF EXISTS public.link_member_bookings();
   DROP FUNCTION IF EXISTS public.relink_booking_member(uuid, uuid, uuid, uuid, uuid);
   DROP FUNCTION IF EXISTS public.member_booking_stats(uuid, uuid, date, time);
   DROP INDEX IF EXISTS booking_requests_restaurant_member_date_idx;
   -- audit rows of manual relinks: copy them out first (select * from events where type = 'booking.member_relinked')
   DELETE FROM events WHERE type = 'booking.member_relinked';
   ALTER TABLE events DROP CONSTRAINT IF EXISTS events_type_check;
   ALTER TABLE events ADD CONSTRAINT events_type_check CHECK (type IN (
     'join','redeem','receipt','campaign','points','unsubscribe','reward_redeem',
     'pos_transaction','pos_refund','pos_customer_link','integration_error','whatsapp_error',
     'onboarding_phase_advanced','consent_imported','consent_granted','consent_revoked','consent_expired',
     'stamp','stamp_reversal','reachability_restored'));
   DELETE FROM supabase_migrations.schema_migrations WHERE version = '088';
   COMMIT;
   ```
   - The 20-type list restored above is the live definition in `baseline-catalog.json` on the box.
   - **Optional, and the owner's call:** undo the backfill's link of the one booking. `member_id` predates 088
     (BOOK-001 links at creation), so the link is not 088-only data. Set `member_id = NULL` for the id whose
     `member_id` is NULL in `booking_requests-predeploy.json` and set now. Match on that exact id on the box; do not
     run a broad UPDATE.
   - Any manual relink made after the release is lost by this revert unless it is replayed from the copied events.

## Cleanup
| item | state |
|---|---|
| remote `rel-book008` | deleted 08:23Z; `ls-remote origin refs/heads/rel-book008` empty |
| local branch `rel-book008` | deleted (`git branch -D`) |
| local ref `release-backup-ca44103` | kept as the rollback handle (not pushed) |
| `origin/release` `ca44103a` → `d74942c1` | replaced (force-push by `release.sh`, by design) |
| box `/home/forge/rel-book008-tmp/` (query helper + SQL; no secrets) | deleted 08:25:39Z (site commands 14475923, 14475932; the first `rm` failed on a `__pycache__` dir that `chmod 600 *` had left without its x bit) |
| box `/home/forge/backups/2026-11-20-book-008/` | kept (11 files, 600, dir 700); delete once the release is accepted |
| worktree `--release-book008` | removed after the records PR was pushed (see handoff) |

## Notes
- Forge rate-limited this run's polling once (`Too many attempts`, about 08:20:45Z). The helper had been polling
  every 3 s and now polls every 10 s. The command that was in flight (14475786, read-only) had already run, so its
  output was fetched, not re-run.
- The two known log lines named in main's 2026-11-20 rulings did not appear in the 5 minutes after the restart (0
  each). The limiter race is now backlog item **BOOK-OPS-1**.
