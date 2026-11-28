---
id: deploys/2026-11-28-book-013-release-runbook
type: deploy
author: dev
created: 2026-11-28
status: executed
supersedes: null
superseded_by: null
related: [kanban:BOOK-013, github:235, github:236, github:240, artifacts/2026-11-26-book-013-r3-handoff, artifacts/2026-11-27-book-013-phone-optional-r2-handoff, reviews/2026-11-26-book-013-r3-re-review, reviews/2026-11-27-book-013-phone-optional-review, deploys/2026-11-26-book-012-release-runbook, artifacts/2026-11-28-book-013-release-handoff]
---

# Deploy: BOOK-013 staff bookings (CRUD, Today sort + Arrived, mode off, phone optional), migrations 095 + 096: `main` @ `875bdb95` to production

**Outcome: RELEASED 2026-11-28 01:39:38Z.** `main` @ **`875bdb95`** (merge of PR #240, develop `28835faf` → main)
→ `origin/release` **`655cd089`**, BUILD_ID **`eFn2M8pzUEgL_DOiytD5C`**, Forge deploy **84247724**. deploy.sh's
`supabase db push` applied **095_booking_staff_crud**, then **096_booking_staff_phone_optional**, before both
restarts. Fresh pids **3456741** (app daemon-746791) / **3456813** (worker daemon-801730), public `/api/health` 200.

Stage: POC. Hosting: the existing Forge box (server 1149990 / site 3123752). Go: owner 2026-11-28 ("release to
production"), relayed by main in brief BOOK-013 release. All times are UTC. Evidence:
`deploys/evidence/2026-11-28-book-013-release/` (logs redacted: the seeded admin, the builder email, a user id).

## Scope
- Prod before: `ffcf73ac` (BOOK-012 release, BUILD_ID `zhPLsPnYAGCuNAHqgZBzJ`). `main` before: `85f777d4` (= prod plus
  BOOK-012 release records, docs only).
- `main` now: **`875bdb95`**, a merge commit from PR **#240** (develop → main, `--match-head-commit 28835faf`,
  merged 01:34:58Z). PR #240 was new: no develop → main PR was open, and the only open PRs into main were #184
  (dependabot) and #69 (an old kanban chore). The tree is the same as develop `28835faf`.
  - **#235** (`2f922d5b`): staff create / edit / cancel bookings, a sortable Today view with Arrived (check-in) and
    undo, and booking mode off hides the booking surfaces. Migration **095**: `source` 'staff', `cancelled_by`
    'staff', the columns `created_by`, `updated_by`, `cancelled_by_user`, `notify_diner`, `last_staff_message_at`,
    `edit_version` (plus a bump trigger), `checked_in_at` and `checked_in_by`, check-in-not-no-show, the events types,
    and the RPCs `staff_create_booking`, `staff_update_booking`, `staff_cancel_booking`, `booking_check_in` and
    `booking_check_in_undo`.
  - **#236** (`28835faf`): staff bookings without a phone (decision 9), AC-26 (no manual member link on a phone-less
    booking), and the Today tie-break for unnamed rows. Migration **096**: `phone` drops NOT NULL, two CHECKs
    (`booking_requests_phone_staff_only`, `booking_requests_no_phone_no_notify`), and the two staff RPCs are
    replaced. It must run after 095.
  - #234: main merged into develop (BOOK-012 records).
- There is no change to `package.json`, `package-lock.json`, `deploy.sh`, `scripts/release.sh`, `next.config.ts`,
  `.env.example`, `src/app/api/cron` or `scripts/cron` (the `git diff --stat 85f777d4 875bdb95` over those paths is
  empty). The lockfile hash is unchanged, so npm ci was skipped on the box.
- Gate parity: develop `28835faf` has the same tree as the branch tip `d23316cc`. Outside `.claude-workspace/` it also
  matches `f291d61e`, the gated commit: build exit 0, tsc exit 0, vitest 733 files / 8,669 tests passed, under the
  heavy lock on 2026-11-27 (`artifacts/2026-11-27-book-013-phone-optional-r2-handoff` AC-3). I did not re-run them.
  PR #240's checks were CodeRabbit SUCCESS.
- Not in this release: the booking template backfill (`scripts/ops/backfill-booking-templates.ts --apply`). It submits
  changed and cancelled templates to Meta for the existing tenants. It is an owner step and was not run.

## Pre-flight (all pass)
| step | result |
|---|---|
| box, first run (2026-11-27 16:32:56Z, site command 14735424) | RELEASE.json source_commit `ffcf73ac`, build_id `zhPLsPnYAGCuNAHqgZBzJ` == `.next/BUILD_ID`; daemon-746791 pid 2511387, daemon-801730 pid 2511460 (up 1 d 10 h); disk 56 % (26 GB free); MemAvailable 2,054 MB; swap 1021/1023 MB; health 200 |
| box, second run (01:35:21Z, site command 14749377) | I re-ran it because the first run was about 9 h old by the time of the merge. Same commit, build and pids (up 1 d 19 h 55 m); disk 56 %; MemAvailable 2,008 MB; swap 1023/1023 MB (as on 11-26; the box never builds); load 0.18; health 200 |
| ledger vs repo (01:35Z, Management API `read_only`, ledger vs `git ls-tree origin/main supabase/migrations`) | 94 rows, tail **094**; the repo has 96 files. Pending: **095 and 096**, nothing else; nothing is in the ledger that is not in the repo. The 16:3xZ check agreed |
| `booking_requests` before (01:36Z, aggregate only) | 7 rows, 0 with a null phone, sources {agent, chat}; `phone` NOT NULL; no `phone_staff_only` or `no_phone_no_notify` constraint |
| restore point | `origin/release` fetched as the local ref **`release-backup-b8976f9`** (not pushed) |
| carried workspace files | the uncommitted INDEX.md entry and the untracked `reviews/2026-11-27-book-013-phone-optional-review.md` are committed on `docs/book-013-release-records` (`87fd9426`, pushed) before the release branch checkout, so release.sh saw a clean tree. `reviews/2026-11-26-book-013-r3-re-review.md` was already tracked (in develop since #235) |

## Runbook (as executed)
```
cd /Users/xavierau/Code/js/whatsapp-crm--book-013
gh pr create --base main --head develop --title "release: BOOK-013 …" --body-file …     # → #240
gh pr merge 240 --merge --match-head-commit 28835faf2f8ee3dccd85c7ebdb09b03a65b92a01    # 01:34:58Z → main 875bdb95
rtk proxy git fetch origin refs/heads/release:refs/heads/release-backup-b8976f9
rtk proxy git checkout -b docs/book-013-release-records origin/main                     # carry INDEX.md + review
git add … && git commit && git push -u origin docs/book-013-release-records             # 87fd9426
rtk proxy git checkout -B release-book013 origin/main                                   # porcelain (tracked) empty
cp ../whatsapp-crm/.env.local ../whatsapp-crm/.env.production.local .                   # cmp identical, gitignored
timeout 120 rtk proxy git push -u origin release-book013                                # ls-remote 875bdb95 == HEAD
SOURCE_REF=release-book013 python3 ~/.claude/bin/resource-lock.py heavy -- bash scripts/release.sh
                                                                                        # 01:36:14–01:38:43Z, exit 0
# Forge auto-deploys `release` → deployment 84247724 (01:38:41–01:39:38Z)
rtk proxy git push origin --delete release-book013; git branch -D release-book013; rm .env.local .env.production.local
```
`RELEASE.json.source_ref` is `release-book013`, the temporary name; `source_commit` is the real main tip `875bdb95`.
release.sh publishes `release` as a new orphan commit each time, so its push shows "(forced update)". This is the
script's normal way of working, as in every release before.

## Verification
| time (UTC) | check | result |
|---|---|---|
| 01:38:43 | release.sh (`release-sh-tail.log`) | **exit 0**; `✓ Compiled successfully`, 101/101 static pages, BUILD_ID `eFn2M8pzUEgL_DOiytD5C`, secret scan clean, `origin/release` `b8976f99` → **`655cd089`** |
| 01:39:10–01:39:38 | Forge deploy 84247724 (`forge-deploy-84247724.log`) | already at 655cd08; 26,055 MB free; bundle from `release-book013 @ 875bdb9`; lockfile unchanged, npm ci skipped; **"Applying migration 095_booking_staff_crud.sql…", then "Applying migration 096_booking_staff_phone_optional.sql…", "Finished supabase db push."**, then the seeder (idempotent), then the app restart, RUNNING, then the worker restart, RUNNING. NOTICEs only: the `DROP … IF EXISTS` skips |
| 01:40:15 | box after (site command 14749523, `box-after.log`) | RELEASE.json **`875bdb95`** / `eFn2M8pzUEgL_DOiytD5C` == `.next/BUILD_ID`; checkout `655cd089`; daemon-746791 pid **3456741** (up 0:00:47), daemon-801730 pid **3456813** (up 0:00:42); public health **200**; `bookings-today-sort` (Today sort test id) in `.next/static/chunks/1gftfk8gz3nr9.js`; `phone_required` (AC-26 guard) in 10 `.next/server` files; `supabase migration list --linked`: 095 and 096 local == remote |
| 01:40:39 | schema read-back (Management API `read_only`, `readback.log`) | ledger tail 096, 095, 094. `booking_requests`: `edit_version` int NOT NULL default 0, `notify_diner` bool NOT NULL default true, `checked_in_at` timestamptz, `checked_in_by`, `created_by`, `updated_by`, `cancelled_by_user`, `last_staff_message_at`; **`phone` is_nullable YES**. CHECKs: `phone_staff_only` = `phone IS NOT NULL OR source = 'staff'`, `no_phone_no_notify` = `phone IS NOT NULL OR notify_diner = false`, `source_check` now includes 'staff', `cancelled_by_check` includes 'staff', `checked_in_not_no_show` present. RPCs: all 5 staff/check-in functions and `bump_booking_edit_version`. Rows: 7, 0 null phone, edit_version 0, all notify true |
| 01:40:4x | from this Mac | `https://app.ohmyclient.io/api/health` 200; `/login` 200; `/api/dashboard/bookings/today` (new) **401** without a session, so the route is live and auth-gated |
| 01:50:08 | logs 10 min after the restart (site command 14749735, `box-logs-10min.log`) | pids unchanged (up 0:10:39 / 0:10:34), health 200. Worker since its banner: `Workers started: … agent-reply`, then **2** `[sweepIntegrationQueues] pruneOrphanIntegrationEvents failed … Bad Request` (known before this release). App: `✓ Ready in 530ms`, the known `next start`/standalone warning, and **2** `[Kapso] Error listing templates: WhatsApp configuration not found` (known). This is the same set the BOOK-012 release saw. **No new error class.** |

Not done: a signed-in browser walk on prod. Staff CRUD writes real rows and could message diners, and there is no
pinned prod test tenant for bookings in this brief. That walk is the owner's pilot step (below).

## Rollback
- **Restore point:** `release-backup-b8976f9` (local ref; prod before was `ffcf73ac`, BUILD_ID `zhPLsPnYAGCuNAHqgZBzJ`).
- **Code: re-releasing the old bundle as it is fails.** `ffcf73ac`'s checkout has no 095 or 096 files, and the ledger
  now has both, so deploy.sh's `supabase db push` stops under `set -e` ("Remote migration versions not found in local
  migrations directory") **before** the restarts. The new code keeps serving (the same failure the BOOK-012 runbook
  describes). Build a rollback bundle from the old code plus the two applied migration files instead. Do not use
  `migration repair --status reverted`, because a later release would run them again. This needs Xavier's OK, because
  release.sh replaces `release`. ETR is about 10 min:
  ```
  git checkout -b rollback-book013 ffcf73ac
  git checkout 875bdb95 -- supabase/migrations/095_booking_staff_crud.sql supabase/migrations/096_booking_staff_phone_optional.sql
  git commit -m "chore: rollback bundle (ffcf73ac + applied migrations 095, 096)" && git push -u origin rollback-book013
  SOURCE_REF=rollback-book013 python3 ~/.claude/bin/resource-lock.py heavy -- bash scripts/release.sh
  ```
  The schema can stay: 095 and 096 are additive for the old code. The new columns have defaults, the old code never
  writes `source` 'staff' and always sends a phone, and the widened CHECKs accept everything it writes.
- **Phone-less staff bookings (review N-2): rolling the app back after phone-less staff bookings exist needs those
  rows given a phone or deleted first.** The old code breaks on them: the old `matchesTodaySearch` calls
  `digitsOf(null)` and throws when the Today search has 4 or more digits, and the old `PhoneLink` renders `tel:null`.
  **Restoring NOT NULL on `phone` fails while such rows exist.** Count them first (read-only):
  `select count(*) from booking_requests where phone is null;` (only `source = 'staff'` rows can match, because of
  `booking_requests_phone_staff_only`).
- **Schema (only if it is ever wanted; not needed for an app rollback):** reverse 096 by dropping the two CHECKs and
  running `ALTER COLUMN phone SET NOT NULL` after the step above. Reverse 095 by dropping the five RPCs, the trigger and
  the columns. That loses staff-booking audit data, so it needs the owner's call. Neither has a down migration in the
  repo.

## Owner next steps
1. **Template backfill** (not run in this release): `scripts/ops/backfill-booking-templates.ts --apply` submits the
   changed and cancelled booking templates to Meta for the existing tenants in Simple booking mode. Without `--apply`
   it is a dry run that only lists those tenants. It is outward-facing, so it needs a separate go.
2. **Pilot walk** on a pilot restaurant in the dashboard: create a staff booking with a phone (the diner gets the
   confirmation only if notify is on), create one without a phone (no message, and no Link member control), edit the
   time (one change message), cancel, open Today and sort by time, name and party, mark Arrived and undo it, and switch
   booking mode off to see the booking surfaces hidden.

## Cleanup
| item | state |
|---|---|
| remote `release-book013` (`875bdb95`) | deleted after the deploy (`ls-remote` empty); local branch deleted |
| `.env.local` / `.env.production.local` copies in this tree | removed after the build (the originals stay in the primary checkout) |
| local ref `release-backup-b8976f9` | kept as the rollback reference |
| docs PR into main (this runbook, kanban BOOK-013 → done, the phone-optional review record) | **https://github.com/xavierau/omc/pull/241**, branch `docs/book-013-release-records`; records commit `086f072b` == `ls-remote` at push, and this line is in the commit after it. Docs and workspace only. Not merged by dev: it targets `main` (ask first) and touches `.claude/kanban.json` |
| worktree `../whatsapp-crm--book-013` | kept: it holds the records branch until the docs PR merges |
