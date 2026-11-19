---
id: deploys/2026-11-19-book-004-release-runbook
type: deploy
author: dev
created: 2026-11-19
status: executed
supersedes: null
superseded_by: null
related: [kanban:BOOK-004, github:196, github:199, artifacts/2026-11-19-rel-book004-handoff, artifacts/2026-11-19-dev-book-004-r4-handoff, deploys/2026-11-19-agent-003-release-runbook]
---

# Deploy: BOOK-004 bookings Calendar + Table views: `main` @ `f1fa26b8` to production

**Outcome: DEPLOYED 2026-11-19 14:37Z. No migration. Every read-only smoke check passes.** Prod serves
`main@f1fa26b8`, release **`79c2634f`**, BUILD_ID **`3swaJrxsFle8BXKvCxYCZ`**. App next-server pid **3267575**,
worker pid **3267616** (supervisor's `npm exec`; its node child 3267656). Both started `Ready` / `Workers started`
with 0 error lines.

Stage: POC (the repo does not import `stages/mature.md`). Hosting: the existing Forge box; the `fly-deploy` and
Cloudflare rules do not apply. Go: Xavier, 2026-11-19 ("continue the merge and publishing"), relayed by main.
Repo `xavierau/omc` is **public**: the evidence below has the build owner's email and the seeded admin's
email/user id redacted, and carries no secrets, phone numbers or message text.

## Scope
- `main` before: **`f7ab94d6`** (AGENT-003 release). `main` now: **`f1fa26b8`** = merge of release PR **#199**
  (develop → main), which brings:
  - `279ff4b3` BOOK-004 bookings Calendar view (month grid + day panel) and Table view (upcoming by day / past
    90 days), phone layouts, ranged `GET /api/dashboard/bookings?from&to` and `?status=pending` (PR #196 squash).
  - `2b144fc2` AGENT-003 release docs (#198, workspace records only).
- Delta `f7ab94d6..f1fa26b8`: 121 files, +16,085 / −198. **Nothing under `supabase/`, `package.json`,
  `package-lock.json`, `scripts/` or `.env.example`** (`git diff --stat f7ab94d6 f1fa26b8 -- supabase package.json
  package-lock.json scripts .env.example` is empty). So: no migration, `npm ci` skipped on the box, no deploy.sh
  change, no env var added or changed, no new cron route.
- Target: `https://app.ohmyclient.io`, Forge server 1149990 / site 3123752, checkout
  `/home/forge/app.ohmyclient.io` on `release`. Supabase prod `whatsapp-crm-pro`.
- Previous prod: `main@f7ab94d6`, release **`fdc9cbe8`**, BUILD_ID `caIeIeX7IH0Qzhqp5AyPG`, app pid 3237666,
  worker pid 3237725 (`npm exec`; node child 3237756).
- Executed from a fresh detached worktree `/Users/xavierau/Code/js/whatsapp-crm--release-book004` at `f1fa26b8`,
  with `.env.local` and `.env.production.local` copied from the primary checkout (`cmp` identical, gitignored, never
  committed). The primary checkout and every other worktree were not touched; nothing was stashed.

## Pre-Flight
- [x] **Gate** on `f1fa26b8` under the heavy lock, 14:27:46–14:28:49Z. Exit codes read from files
      (`artifacts/evidence/2026-11-19-book-004-release/ac-gate-*`):
  - `npm ci` exit 0 (fresh tree, no `node_modules`).
  - `tsc --noEmit` exit 0.
  - `vitest run` exit 0: **652 files passed / 13 skipped, 7,451 tests passed, 94 skipped, 2 todo**.
- [x] **Box (14:29:24Z)** (`box-preflight.log`): disk **27,390 MB** free (floor 3 GB), MemAvailable **2,326 MB**,
      swap 79 MB free, load 0.22. Serving `rel-agent003` / `f7ab94d6` / `caIeIeX7IH0Qzhqp5AyPG` as expected.
- [x] **DB backup:** none taken (no migration). Latest managed backup, read from the box via the Management API:
      **2306777673 COMPLETED 2026-11-18T19:32:11Z** (physical, WAL-G on, PITR off; `managed-backups.log`).
- [x] **Restore point:** `origin/release` (`fdc9cbe8`) fetched as the local ref **`release-backup-fdc9cbe`**
      (not pushed).

## Runbook (as executed, UTC)
```
rtk proxy git fetch origin
rtk proxy git worktree add --detach /Users/xavierau/Code/js/whatsapp-crm--release-book004 f1fa26b8
cp /Users/xavierau/Code/js/whatsapp-crm/.env.local /Users/xavierau/Code/js/whatsapp-crm/.env.production.local \
   /Users/xavierau/Code/js/whatsapp-crm--release-book004/                               # cmp identical
cd /Users/xavierau/Code/js/whatsapp-crm--release-book004
resource-lock.py heavy -- bash -c 'npm ci; npx tsc --noEmit; npx vitest run'            # all exit 0
# box pre-flight + managed backup id via Forge site commands (token read on the box, never printed)
rtk proxy git fetch origin refs/heads/release:refs/heads/release-backup-fdc9cbe           # fdc9cbe8
rtk proxy git branch rel-book004 f1fa26b8
timeout 120 rtk proxy git push origin rel-book004:refs/heads/rel-book004                  # ls-remote f1fa26b8 ✓
SOURCE_REF=rel-book004 resource-lock.py heavy -- bash scripts/release.sh                   # exit 0, 14:30:59–14:34:19Z
git ls-remote origin refs/heads/release                                                    # 79c2634f ✓ (was fdc9cbe8)
# Forge auto-deploy 83467950: deploy.sh → "Remote database is up to date." → seed → restart app + worker
timeout 120 rtk proxy git push origin --delete rel-book004                                 # ls-remote empty ✓
```
release.sh tail (`release-sh.log`):
```
→   building rel-book004 @ f1fa26b
→   node v22.21.1
→   BUILD_ID 3swaJrxsFle8BXKvCxYCZ
→ Scanning bundle for inlined credentials
→   clean
 + fdc9cbe8...79c2634f 79c2634fb2eb531d478b50e628971bd4095f5365 -> release (forced update)
✓ Released rel-book004 @ f1fa26b → origin/release (79c2634)
```

**Forge deployment 83467950** (`GET …/deployments/83467950/log`, redacted copy `forge-deploy-83467950.log`):
```
Thu Nov 19 14:36:42 UTC 2026
 + fdc9cbe8...79c2634f release    -> origin/release  (forced update)
  already at 79c2634
  27385MB free (minimum 1500MB)
  BUILD_ID 3swaJrxsFle8BXKvCxYCZ
  from rel-book004 @ f1fa26b — Merge pull request #199 from xavierau/develop
  lockfile unchanged (5b141452304d) — node_modules is current, skipping npm ci
→ Applying pending migrations
Remote database is up to date.
→ Restarting daemons
  app is RUNNING
  worker is RUNNING
✓ Deploy complete
```
No migration was applied ("Remote database is up to date."), as expected for this delta.

## Deploy facts
| time (UTC) | event |
|---|---|
| 14:33:04 | bundle built on the Mac (`RELEASE.json.built_at`, node v22.21.1) |
| 14:34:18 | `release` force-pushed → `79c2634f`; Forge deployment 83467950 queued |
| 14:36:18 | deployment started |
| 14:36:42 | deploy.sh starts; checkout already at `79c2634`; 27,385 MB free; `npm ci` skipped |
| 14:36:42–14:37:03 | `supabase db push`: **Remote database is up to date** (no migration) |
| 14:37:03 | app daemon-746791 → **next-server 3267575** (`✓ Ready in 456ms`) |
| 14:37:07 | worker daemon-801730 → **pid 3267616** (`npm exec`; node 3267656); `Workers started: campaign, event-dispatch, receipt, email-send, integration-inbound, integration-outbound, agent-reply` |
| 14:37:08 | Forge deployment 83467950 finished |
| 14:37:45 | box `RELEASE.json`: source_ref `rel-book004`, source_commit `f1fa26b8…`, build_id `3swaJrxsFle8BXKvCxYCZ` == `.next/BUILD_ID` |

## Post-Deploy Verification (read-only, unauthenticated, no data created; ALL PASS)
| check | result |
|---|---|
| release | `git ls-remote origin refs/heads/release` = `79c2634fb2eb531d478b50e628971bd4095f5365` (was `fdc9cbe8`) |
| served build | `/login` **200**, embeds `3swaJrxsFle8BXKvCxYCZ` once and the old BUILD_ID 0 times; `/api/health` **200** |
| bookings page | `/dashboard/bookings` **307 → /login** (unauthenticated) |
| bookings API | `GET /api/dashboard/bookings?from=2026-11-01&to=2026-11-30` **401** `{"error":"Unauthorized"}` (not 500) |
| BOOK-004 in bundle | `/_next/static/chunks/0s_j8m74ejgk_.js` **200** from prod, contains `bookings-calendar` ×7 |
| processes | app 3237666 → **3267575**, worker 3237725 → **3267616**: both changed |
| stability (14:38:43Z) | next-server elapsed 1:39, worker 1:37, no restart; app log 2 lines after `Ready`, worker 0 lines after `Workers started`; **0** error/warn lines in both |
| box after | MemAvailable 2,412 MB, swap 74 MB free, disk 27,385 MB free |
| not run | authenticated UI, any tenant login. Staff test the calendar/table on their own accounts |

Evidence: `artifacts/evidence/2026-11-19-book-004-release/` (`ac-smoke.log`, `box-after.log`, `box-stability.log`,
`box-pids-before.log`).

## Rollback (ready, NOT executed; ETR ≈ 3 min)
Code only; there is no DB change to revert. This is a force-push to `release` and **needs Xavier's OK**:
```
# from any worktree of this repo (local refs are shared)
rtk proxy git push --force origin release-backup-fdc9cbe:refs/heads/release
git ls-remote origin refs/heads/release      # must read fdc9cbe8ace40deff90e7fe32d99e559583dac91
# Forge redeploys: RELEASE.json source_commit f7ab94d6, BUILD_ID caIeIeX7IH0Qzhqp5AyPG, both pids change, /api/health 200.
```
If the local ref is gone, force-push by SHA `fdc9cbe8ace40deff90e7fe32d99e559583dac91`. The old code's bookings page
is the flat card list and its API ignores `from`/`to`; no stored data depends on BOOK-004.

## Cleanup
| item | state |
|---|---|
| remote `rel-book004` | deleted ~14:38Z; `ls-remote origin refs/heads/rel-book004` empty |
| local branch `rel-book004` | deleted (`git branch -D`) |
| local ref `release-backup-fdc9cbe` | kept as the rollback handle |
| `origin/release` `fdc9cbe8` → `79c2634f` | replaced (force-push by `release.sh`, by design) |
| worktree `--release-book004` | removed after the docs PR was pushed (see handoff) |
