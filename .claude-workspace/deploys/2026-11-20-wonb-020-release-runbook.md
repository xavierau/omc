---
id: deploys/2026-11-20-wonb-020-release-runbook
type: deploy
author: dev
created: 2026-11-20
status: executed
supersedes: null
superseded_by: null
related: [kanban:WONB-020, github:212, github:221, reviews/2026-11-20-wonb-020-r6-re-review, artifacts/2026-11-20-dev-wonb-020-r6-handoff, artifacts/2026-11-20-dev-wonb-020-r4-handoff, deploys/2026-11-20-book-007-release-runbook, deploys/2026-11-20-agent-005-release-runbook]
---

# Deploy: WONB-020 imported-member welcome claim with migrations 089 + 090: `main` @ `660f82df` to production

**Outcome: DEPLOYED 2026-11-20 13:27:54Z (21:27 HKT). Migrations 089 and 090 were applied before the daemons
restarted.** Prod serves `main@660f82df`, release **`c353dea9`**, BUILD_ID **`xk8QzLQHF8mIsyZ55BQSi`**. App
next-server pid **3773305**, worker pid **3773365** (`npm exec`). The catalog is exactly what 089 and 090
define, and the `welcome_offer = true` set is the same 314 coupons the baseline predicate selected (0 missing,
0 extra). Every read-only check passes; the 10-minute log window is in "Post-Deploy Verification".

Stage: POC (the repo does not import `stages/mature.md`). Hosting: the existing Forge box; the `fly-deploy` and
Cloudflare rules do not apply. Go: Xavier, 2026-11-20 ("merge and release after the review"), relayed by main; it
covers squash-merging #212 into develop, the develop → main release PR and merge, applying 089 + 090 through
deploy.sh's `supabase db push`, and release.sh's force-push of `release`. The verifier re-review of the last round
is APPROVED (`reviews/2026-11-20-wonb-020-r6-re-review`, committed to the PR branch as `0fba9c97` before the merge).
Repo `xavierau/omc` is **public**: no tenant id, member id, coupon id or code, phone, email or secret appears
below or in the evidence (`built_by`, the seeded admin email and its user id are redacted). All times UTC.

## Scope
- `develop` before: `89160ef5` (AGENT-005 release records). PR **#212** squash-merged 13:20:20Z →
  develop **`304dd641`**.
- `main` before: **`fe1cdbfb`** (AGENT-005 release). `main` now: **`660f82df`** = merge of release PR **#221**
  (develop `304dd641` → main, 13:25:23Z), which brings:
  - `304dd641` WONB-020 (#212): an imported member (no `join` event, no welcome offer yet) claims the welcome
    offer once via WhatsApp JOIN; the web join form points such a member to WhatsApp (`join-claim-whatsapp`). A
    Redis welcome-claim lock serialises concurrent claims.
    - Migration **089_events_join_member_index** (additive): `idx_events_join_restaurant_member` on
      `events (restaurant_id, member_id) WHERE type = 'join'`.
    - Migration **090_coupons_welcome_offer** (additive): `coupons.welcome_offer boolean NOT NULL DEFAULT false`,
      backfilled true for `type = 'welcome'` coupons and coupons of a same-restaurant welcome campaign.
  - `89160ef5` AGENT-005 release records (#220, workspace records only).
- Delta `fe1cdbfb..660f82df`: migrations 089 and 090 only. No change to `package.json`, `package-lock.json`,
  `scripts/`, `deploy.sh` or `.env.example`; no env var added; no cron route changed.
- Target: `https://app.ohmyclient.io`, Forge server 1149990 / site 3123752, checkout
  `/home/forge/app.ohmyclient.io` on `release`. Supabase prod `whatsapp-crm-pro` (`uzimqndenngebzgndlhd`).
- Previous prod: `main@fe1cdbfb`, release **`d05e6470`**, BUILD_ID `F2oHXhD6zjqi7IwuTmGfA`, app pid 3671054,
  worker pid 3671113.
- Executed from a fresh detached worktree `/Users/xavierau/Code/js/whatsapp-crm--release-wonb020` at `304dd641`,
  with `.env.local` and `.env.production.local` copied from the primary checkout (`cmp` identical, gitignored,
  never committed). The primary checkout and every other worktree were not touched, except the PR branch commit in
  `--wonb-020` that the brief ordered.

## Pre-Flight
- [x] **Range** (13:20Z): `origin/main..origin/develop` = `89160ef5`, `304dd641`. `main` is not an ancestor of
      develop (main carries its merge commits), so the brief's conflict check ran: `git merge-tree --write-tree
      origin/main origin/develop` exit 0, tree **`09cb7ee6`** == develop's tree. No merge of main into develop
      was needed.
- [x] **Gate** on `304dd641` under the heavy lock, 13:20:45–13:23:00Z. Exit codes read from files
      (`artifacts/evidence/2026-11-20-wonb-020-release/ac-gate-*`):
  - `npm ci` exit 0 (fresh tree).
  - `tsc --noEmit` exit 0 (empty log).
  - `vitest run` exit 0: **689 files passed / 15 skipped, 7,899 tests passed, 129 skipped, 2 todo**.
  - The released tree (`660f82df`) is the same tree as `304dd641` (`09cb7ee6…`).
- [x] **Box** (13:21:14Z, Forge site command 14485032, `box-preflight.log`): HEAD `d05e6470`, BUILD_ID
      `F2oHXhD6zjqi7IwuTmGfA`, RELEASE.json source_commit `fe1cdbfb`; app 3671054 and worker 3671113 up 4h37m.
      Disk 26,965 MB free, MemAvailable 2,337 MB, swap 1.7 MB free, load 0.43. The site `.env` has a non-empty
      `SUPABASE_ACCESS_TOKEN` naming project `uzimqndenngebzgndlhd`, and a `REDIS_URL`.
- [x] **Backup (13:22:28–13:22:36Z), before the release PR existed and before any migration** (Forge site command
      14485088, `box-backup.log`). The helper `/home/forge/rel-wonb020-tmp/q.py` (copy: `box-helper-q.py`) called
      the Supabase Management API from the box, read-only query endpoint, with the token read in-process from the
      site `.env`, never printed. Box dir `/home/forge/backups/2026-11-20-wonb-020/` (700, files 600):
      | file | content | sha256 |
      |---|---|---|
      | `managed-backups.json` | backup list: 7 dailies, WAL-G on, PITR off; newest **2317028887 COMPLETED 2026-11-19T19:32:05Z** | `a99749b99b1519a8e254033fccfd3316562c48d3bea2123d106cda9850062dc7` |
      | `baseline-catalog.json` | catalog + counts | `4c58d5f681f7fe269b8a5e407613cc82b440db29160e285e4178cd10f6413a6b` |
      | `baseline-welcome-coupon-ids.json` | id, type, campaign_id of the 314 coupons 090's backfill selects | `694fff2fa82a361be0a836aeb0193f5d9104b67985901fe9653be8c464935ba1` |
      Baseline catalog:
      - Ledger tail 084–**088**, no 089/090.
      - `events` indexes: `events_pkey`, `idx_events_created_at`, `idx_events_restaurant_id`, `idx_events_type`,
        `uq_events_stamp_dedup`; no `idx_events_join_restaurant_member`.
      - `coupons`: 18 columns, no `welcome_offer`.
      - Counts: events **12,813** (type join 314), 4,112 kB; coupons **570** (type welcome **24**, promo coupons of
        a same-restaurant welcome campaign **290**, backfill predicate **314**); members 4,229; restaurants 7.
- [x] **089 sizing** (brief note): `events` is 12,813 rows / 4 MB, far below ~1M, so no `CREATE INDEX
      CONCURRENTLY` pre-create; db push ran the plain `CREATE INDEX IF NOT EXISTS`.
- [x] **Restore point.** `origin/release` (`d05e6470`) fetched as the local ref **`release-backup-d05e647`** (not
      pushed).

## Runbook (as executed)
```
# PR branch (in ../whatsapp-crm--wonb-020)
rtk proxy git commit -- reviews/2026-11-20-wonb-020-r6-re-review.md INDEX.md                # 0fba9c97
timeout 120 rtk proxy git push origin HEAD:refs/heads/feature/wonb-020-imported-welcome-claim  # ls-remote 0fba9c97 ✓
gh pr merge 212 --squash --match-head-commit 0fba9c97…                                      # 13:20:20Z → develop 304dd641
# release
cd /Users/xavierau/Code/js/whatsapp-crm
rtk proxy git fetch origin
rtk proxy git merge-tree --write-tree origin/main origin/develop                            # exit 0, tree 09cb7ee6 == develop
rtk proxy git worktree add --detach ../whatsapp-crm--release-wonb020 304dd641
cp .env.local .env.production.local ../whatsapp-crm--release-wonb020/                      # cmp identical
cd ../whatsapp-crm--release-wonb020
resource-lock.py heavy -- bash -c 'npm ci; npx tsc --noEmit; npx vitest run'                 # 13:20:45–13:23:00Z, all exit 0
# box pre-flight 14485032 (read-only); backup + baseline 14485088 (13:22:28Z)
rtk proxy git fetch origin refs/heads/release:refs/heads/release-backup-d05e647              # d05e6470
gh pr create --base main --head develop                                                     # #221 13:23:07Z, MERGEABLE/CLEAN, CodeRabbit pass
gh pr merge 221 --merge --match-head-commit 304dd641…                                       # 13:25:23Z → 660f82df
rtk proxy git checkout -B release-wonb020 660f82df
timeout 120 rtk proxy git push origin release-wonb020:refs/heads/release-wonb020             # ls-remote 660f82df ✓
SOURCE_REF=release-wonb020 resource-lock.py heavy -- bash scripts/release.sh                # exit 0, 13:25:40–13:27:04Z
git ls-remote origin refs/heads/release                                                       # c353dea9 ✓ (was d05e6470)
# Forge auto-deploy 83563044: deploy.sh → supabase db push (089, 090) → seed → restart app + worker
# post-deploy box 14485298; catalog 14485311; 10-min log window 14485644 (13:38:20Z)
timeout 120 rtk proxy git push origin --delete release-wonb020                                # ls-remote empty ✓
rm -rf /home/forge/rel-wonb020-tmp                                                            # site command 14485662
```
release.sh tail (`release-sh.log`; the bundle was built at 13:26:48Z):
```
→   building release-wonb020 @ 660f82d
→   node v22.21.1
→   BUILD_ID xk8QzLQHF8mIsyZ55BQSi
→ Scanning bundle for inlined credentials
→   clean
 + d05e6470...c353dea9 c353dea911810fb79275c00bd4215d7399f0ab2c -> release (forced update)
✓ Released release-wonb020 @ 660f82d → origin/release (c353dea)
```

**Migration ordering, proven from the Forge deployment log** (`GET …/deployments/83563044/log`, redacted copy
`forge-deploy-83563044.log`):
```
Fri Nov 20 13:27:29 UTC 2026
  already at c353dea
  26962MB free (minimum 1500MB)
  BUILD_ID xk8QzLQHF8mIsyZ55BQSi
  from release-wonb020 @ 660f82d — Merge pull request #221 from xavierau/develop
  lockfile unchanged (5b141452304d) — node_modules is current, skipping npm ci
→ Applying pending migrations
 • 089_events_join_member_index.sql
 • 090_coupons_welcome_offer.sql
Applying migration 089_events_join_member_index.sql...
Applying migration 090_coupons_welcome_offer.sql...
Finished supabase db push.
→ Seeding platform admin (idempotent)
→ Restarting daemons
  restarting app → daemon-746791 … app is RUNNING
  restarting worker → daemon-801730 … worker is RUNNING
✓ Deploy complete
```
deploy.sh runs under `set -euo pipefail` (line 2); `supabase db push` is line 267 and "Restarting daemons" line 276,
so `Finished supabase db push.` comes before both restarts. The new app process started at 13:27:48Z and the worker
at 13:27:52Z, after deploy.sh started at 13:27:29Z and inside the deployment window 13:27:04–13:27:54Z.
`schema_migrations` has no apply timestamp column, so the order rests on this log, as for BOOK-007.

## Deploy facts
| time (UTC) | event |
|---|---|
| 13:20:20 | PR #212 squash-merged → develop `304dd641` |
| 13:22:28–36 | backup + baseline catalog on the box |
| 13:25:23 | main merge commit `660f82df` (PR #221) |
| 13:26:48 | bundle built on the Mac (node v22.21.1) |
| 13:27:04 | `release` force-pushed → `c353dea9`; Forge deployment 83563044 starts |
| 13:27:29 | deploy.sh starts; checkout already at `c353dea`; 26,962 MB free; `npm ci` skipped |
| 13:27:29–~13:27:47 | `supabase db push`: **089 and 090 applied**, `Finished supabase db push.` |
| 13:27:48 | app daemon-746791 → **next-server 3773305** |
| 13:27:52 | worker daemon-801730 → **pid 3773365** |
| 13:27:54 | Forge deployment 83563044 finished |
| 13:28:19 | box `RELEASE.json`: source_ref `release-wonb020`, source_commit `660f82df…`, build_id `xk8QzLQHF8mIsyZ55BQSi` == `.next/BUILD_ID`; HEAD `c353dea9`; only dirt ` M supabase/.temp/cli-latest` (pre-existing) |

`source_ref` reads `release-wonb020`, the temp branch name (memory `project_release_from_worktree`);
`source_commit` is the real main tip.

## Migrations 089 + 090 result (read-only, Management API from the box, 13:28:35Z; `ac3-post-catalog.log`)
| check | result |
|---|---|
| ledger | `088`, **`089` (events_join_member_index)**, **`090` (coupons_welcome_offer)** |
| 089 index | `CREATE INDEX idx_events_join_restaurant_member ON public.events USING btree (restaurant_id, member_id) WHERE (type = 'join'::text)` |
| 090 column | `welcome_offer` boolean, is_nullable **NO**, default **false** (19 columns, was 18) |
| backfill | `welcome_offer = true` **314** == baseline predicate 314 (type welcome 24 + same-restaurant welcome-campaign promo 290); id sets compared on the box: in both 314, only after 0, only baseline 0 |
| backfill completeness | predicate rows still `false`: **0** |
| row counts | events 12,813, coupons 570, members 4,229, restaurants 7: all equal to the 13:22Z baseline |
Box file: `after-catalog.json` (sha256 `89a5ffdcef036aaead27a3b77862cc88a6e22e284e777abd76e6b6d28bead16b`, 600).
No welcome coupon was minted between the baseline and the check (counts equal, set equal), so the backfill result
is not masked by new-code mints.

## Post-Deploy Verification (read-only: no tenant login, no JOIN sent, no join form submitted, no DB write)
| check | result |
|---|---|
| release | `git ls-remote origin refs/heads/release` = `c353dea911810fb79275c00bd4215d7399f0ab2c` (was `d05e6470`) |
| box provenance | `RELEASE.json` source_commit `660f82df15ce4db1c299930f1682d8c36f907c70` == main merge commit; build_id == `.next/BUILD_ID` |
| served build | public `https://app.ohmyclient.io/api/health` **200**; `/login` **200**, embeds `xk8QzLQHF8mIsyZ55BQSi` once and the old BUILD_ID 0 times (`box-after-deploy.log`) |
| processes | app 3671054 → **3773305**, worker 3671113 → **3773365**; supervisor daemon-746791 and daemon-801730 RUNNING, uptime 0:00:31 / 0:00:27 at 13:28:19Z |
| bundle marker | `join-claim-whatsapp` in 1 file of `.next/static` (`chunks/210vzazpahfrr.js`) and 2 of `.next/server`; `welcome-claim` in 6 files of `.next/server` |
| 10-min logs | Forge site command 14485644 at 13:38:20Z (`box-stability-10min.log`), app up 10:31, worker up 10:27, same pids: **0** lines matching welcome-claim / welcome_offer / redis / claim lock / ECONNREFUSED in either log. Worker: the start lines only, 0 error/warn. App: the 5 startup lines plus **2 × `[Kapso] Error listing templates: WhatsApp configuration not found`**, the pre-existing `console.warn` in `src/infrastructure/kapso/template-client.ts` that BOOK-007's runbook traced across earlier builds; no Kapso file is in `fe1cdbfb..660f82df`, so it is not attributable to this release. `/api/health` 200 |
| box after | MemAvailable 2,293 MB, swap 74.8 MB free, load 0.33, disk 26,962 MB free |
| not run | a real JOIN by an imported member (needs a prod send): the owner's follow-up real-member scan |

## Rollback (ready, NOT executed; ETR ≈ 3 min)
1. **Code** to the AGENT-005 release (`d05e6470` = `main@fe1cdbfb`, BUILD_ID `F2oHXhD6zjqi7IwuTmGfA`). This is a
   force-push to `release` and **needs Xavier's OK**:
   ```
   # from any worktree of this repo (local refs are shared)
   rtk proxy git push --force origin release-backup-d05e647:refs/heads/release
   git ls-remote origin refs/heads/release      # must read d05e64708ee04b39a8613e7158f2e519786e6981
   # Forge redeploys: RELEASE.json source_commit fe1cdbfb, BUILD_ID F2oHXhD6zjqi7IwuTmGfA, both pids change, /api/health 200.
   ```
   If the local ref is gone, force-push by SHA `d05e64708ee04b39a8613e7158f2e519786e6981`. deploy.sh's `db push`
   finds nothing to apply.
2. **089 and 090 are additive and need no rollback for a code revert.** The old code never reads
   `welcome_offer` (inserts get the default `false`) and never uses the new index. They stay unless the owner
   decides otherwise (a separate decision). Exact revert, if ever wanted, as one transaction through the Management
   API, after the code rollback:
   ```sql
   BEGIN;
   ALTER TABLE coupons DROP COLUMN IF EXISTS welcome_offer;
   DROP INDEX IF EXISTS idx_events_join_restaurant_member;
   DELETE FROM supabase_migrations.schema_migrations WHERE version IN ('089', '090');
   COMMIT;
   ```
   Dropping `welcome_offer` loses the mark on any welcome coupon minted after the deploy whose campaign is later
   deleted or retyped; the baseline set is in `baseline-welcome-coupon-ids.json` on the box.

## Cleanup
| item | state |
|---|---|
| remote `release-wonb020` | deleted 13:38Z; `ls-remote origin refs/heads/release-wonb020` empty |
| local branch `release-wonb020` | deleted (`git branch -D`) with the release worktree |
| local ref `release-backup-d05e647` | kept as the rollback handle (not pushed) |
| `origin/release` `d05e6470` → `c353dea9` | replaced (force-push by `release.sh`, by design) |
| box `/home/forge/rel-wonb020-tmp/` (query helper; no secrets) | deleted 13:38:46Z (site command 14485662) |
| box `/home/forge/backups/2026-11-20-wonb-020/` | kept (4 files, 600: `managed-backups.json`, `baseline-catalog.json`, `baseline-welcome-coupon-ids.json`, `after-catalog.json`); delete once the release is accepted |
| worktree `--wonb-020` | removed 13:39Z per memory `pattern_squash_merged_worktree_cleanup`: `git diff 0fba9c97 origin/main` empty (whole tree) and clean status, then `hooks/worktree_remove.py` (slot released; no teardown script), `git worktree remove` (no `--force`), `git branch -D`, remote branch deleted (`ls-remote` empty). Its gitignored `.env*` copies were identical to the primary checkout's; `logs/` held only test-run webhook logs |
| worktree `--release-wonb020` | removed after the records commit was pushed (see handoff) |
