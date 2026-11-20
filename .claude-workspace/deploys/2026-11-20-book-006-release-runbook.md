---
id: deploys/2026-11-20-book-006-release-runbook
type: deploy
author: dev
created: 2026-11-20
status: executed
supersedes: null
superseded_by: null
related: [kanban:BOOK-006, github:207, github:208, artifacts/2026-11-20-rel-book006-handoff, artifacts/2026-11-20-book-006-handoff, artifacts/2026-11-20-book-006-change-request-pairs-impl, deploys/2026-11-20-agent-004-release-runbook]
---

# Deploy: BOOK-006 change-request pairs: `main` @ `99f81731` to production

**Outcome: DEPLOYED 2026-11-20 03:16Z (11:16 HKT). No migration.** Prod serves `main@99f81731`, release
**`8de9aea6`**, BUILD_ID **`e1I15X2aClu1mW4QksVz2`**. App next-server pid **3545420**, worker pid **3545481**
(`npm exec`). Every read-only check passes except one log line: the app logged
`[AgentBooking] rate limiter unavailable, allowing: Error` once after the restart. That line is **pre-existing** (5
earlier occurrences under previous builds, one of them under the AGENT-004 build) and comes from the agent-booking
rate limiter, which BOOK-006 does not change; see "Exception" below. The owner's live check of a change-request pair is still to do.

Stage: POC (the repo does not import `stages/mature.md`). Hosting: the existing Forge box; the `fly-deploy` and
Cloudflare rules do not apply. Go: Xavier, 2026-11-20 ("merge and release it"), relayed by main. Repo `xavierau/omc`
is **public**: no tenant id, booking id, user id, email, phone number, message text or secret appears below or in the
evidence (`built_by`, the seeded admin email and its user id are redacted). All times are UTC.

## Scope
- `main` before: **`4af4caaf`** (AGENT-004 release). `main` now: **`99f81731`** = merge of release PR **#208**
  (develop `2113af2e` → main), which brings:
  - `2113af2e` BOOK-006 (PR #207 squash): a pending booking with an open AI change request shows a
    "change requested → new slot" marker and no Confirm/Decline; staff decide the pair through the change row.
    Staff-facing pending counts count the pair once. Open changes are found from one tenant-scoped read of the
    restaurant's pending rows (`replaces_booking_id`). No API, SQL, migration or diner-message change. Files:
    `src/components/dashboard/{booking-row,bookings/*}.tsx|ts`, `src/domain/entities/booking-request.ts`,
    `src/infrastructure/supabase/repositories/booking-request-repository.ts`, `src/messages/{en,zh-HK}.json`, tests.
  - `183e8018` AGENT-004 release docs (#206, workspace records only).
- Delta `4af4caaf..99f81731`: no file under `supabase/migrations`; no change to `package.json`, `package-lock.json`,
  `scripts/`, `deploy.sh` or `.env.example`. The only `supabase/` paths are
  `src/infrastructure/supabase/repositories/booking-request-repository.ts` and its test (application code).
  `replaces_booking_id` comes from migration 085, already on prod (the DB check below reads it).
- Target: `https://app.ohmyclient.io`, Forge server 1149990 / site 3123752, checkout
  `/home/forge/app.ohmyclient.io` on `release`.
- Previous prod: `main@4af4caaf`, release **`e5ddd701`**, BUILD_ID `zzJgH7D65-G0P4rKNa3uS`, app pid 3531138,
  worker pid 3531178.
- Executed from a fresh detached worktree `/Users/xavierau/Code/js/whatsapp-crm--release-book006` at `2113af2e`, with
  `.env.local` and `.env.production.local` copied from the primary checkout (`cmp` identical, gitignored, never
  committed). The primary checkout and every other worktree (incl. `--book-006` and `--book-007`) were not touched;
  nothing stashed.

## Pre-Flight
- [x] **Range** (03:03Z): `origin/develop` = `2113af2e`; `origin/main..origin/develop` = `183e8018`, `2113af2e` only.
- [x] **Gate** on `2113af2e` under the heavy lock, 03:04:21–03:07:10Z. Exit codes read from files
      (`artifacts/evidence/2026-11-20-book-006-release/ac-gate-*`):
  - `npm ci` exit 0 (fresh tree, no `node_modules`).
  - `tsc --noEmit` exit 0 (empty log).
  - `vitest run` exit 0: **663 files passed / 14 skipped, 7,584 tests passed, 127 skipped, 2 todo**.
  - The released tree (`99f81731`) is the same tree as `2113af2e` (`5dbcbe26…`).
- [x] **Box** (03:04:39Z, Forge site command 14469779, `box-preflight.log`): HEAD `e5ddd701`, `.next/BUILD_ID`
      `zzJgH7D65-G0P4rKNa3uS`, RELEASE.json source_commit `4af4caaf`; app 3531138 and worker 3531178 up 25m. Disk
      26,925 MB free (deploy.sh floor 1,500 MB), MemAvailable 2,334 MB, swap 100 MB free, load 0.14. Two more
      read-only site commands: 14469781 (`date -u`, probing the API's empty 202 response) and 14469794 (counts that
      the site `.env` has a non-empty `SUPABASE_ACCESS_TOKEN` and points at project `uzimqndenngebzgndlhd`: 1 and 1).
- [x] **No DB backup taken**: no migration and no data write in this release.
- [x] **Restore point.** `origin/release` (`e5ddd701`) fetched as the local ref **`release-backup-e5ddd70`** (not
      pushed).

## Runbook (as executed)
```
cd /Users/xavierau/Code/js/whatsapp-crm
rtk proxy git fetch origin
rtk proxy git worktree add --detach ../whatsapp-crm--release-book006 2113af2e
cp .env.local .env.production.local ../whatsapp-crm--release-book006/                    # cmp identical
rtk proxy git fetch origin refs/heads/release:refs/heads/release-backup-e5ddd70            # e5ddd701
cd ../whatsapp-crm--release-book006
resource-lock.py heavy -- bash -c 'npm ci; npx tsc --noEmit; npx vitest run'               # all exit 0
# box pre-flight: Forge site command 14469779 (read-only)
rtk proxy git merge-tree --write-tree origin/main origin/develop                          # exit 0, tree 5dbcbe26 == develop
gh pr create --base main --head develop                                                   # #208 03:07:24Z, MERGEABLE/CLEAN, CodeRabbit pass
gh pr merge 208 --merge --match-head-commit 2113af2e…                                     # 03:10:34Z → 99f81731
rtk proxy git checkout -B rel-book006 99f81731
timeout 120 rtk proxy git push origin rel-book006:refs/heads/rel-book006                   # ls-remote 99f81731 ✓
SOURCE_REF=rel-book006 resource-lock.py heavy -- bash scripts/release.sh                   # exit 0, 03:10:52–03:15:39Z
git ls-remote origin refs/heads/release                                                     # 8de9aea6 ✓ (was e5ddd701)
# Forge auto-deploy 83521251: deploy.sh → db push (nothing pending) → seed → restart app + worker
timeout 120 rtk proxy git push origin --delete rel-book006                                  # ls-remote empty ✓
```
The bundle was built at 03:13:07Z. release.sh tail (`release-sh.log`):
```
→   building rel-book006 @ 99f8173
→   node v22.21.1
→   BUILD_ID e1I15X2aClu1mW4QksVz2
→ Scanning bundle for inlined credentials
→   clean
 + e5ddd701...8de9aea6 8de9aea69fc4e3910bd8ad0755cdcefb718329d6 -> release (forced update)
✓ Released rel-book006 @ 99f8173 → origin/release (8de9aea)
```

**Forge deployment log** (`GET …/deployments/83521251/log`, redacted copy `forge-deploy-83521251.log`):
```
Fri Nov 20 03:16:04 UTC 2026
  already at 8de9aea
  26880MB free (minimum 1500MB)
  BUILD_ID e1I15X2aClu1mW4QksVz2
  from rel-book006 @ 99f8173 — Merge pull request #208 from xavierau/develop
  lockfile unchanged (5b141452304d) — node_modules is current, skipping npm ci
→ Applying pending migrations
Remote database is up to date.
→ Seeding platform admin (idempotent)
→ Restarting daemons
  app is RUNNING
  worker is RUNNING
✓ Deploy complete
```

## Deploy facts
| time (UTC) | event |
|---|---|
| 03:10:34 | main merge commit `99f81731` (PR #208) |
| 03:13:07 | bundle built on the Mac (node v22.21.1) |
| 03:15:38 | `release` force-pushed → `8de9aea6`; Forge deployment 83521251 starts |
| 03:16:04 | deploy.sh starts; checkout already at `8de9aea`; 26,880 MB free; `npm ci` skipped |
| 03:16:04–03:16:23 | `supabase db push`: **Remote database is up to date** (no migration applied) |
| ~03:16:23 (from etime) | app daemon-746791 → **next-server 3545420** (`✓ Ready in 1569ms`) |
| ~03:16:30 (from etime) | worker daemon-801730 → **pid 3545481** (`npm exec`); `Workers started: campaign, event-dispatch, receipt, email-send, integration-inbound, integration-outbound, agent-reply` |
| 03:16:34 | Forge deployment 83521251 finished |
| 03:17:06 | box `RELEASE.json`: source_ref `rel-book006`, source_commit `99f81731…`, build_id `e1I15X2aClu1mW4QksVz2` == `.next/BUILD_ID`; HEAD `8de9aea6` (`box-after-deploy.log`) |

## Post-Deploy Verification (read-only: no tenant login, no WhatsApp send, no DB write)
| check | result |
|---|---|
| release | `git ls-remote origin refs/heads/release` = `8de9aea69fc4e3910bd8ad0755cdcefb718329d6` (was `e5ddd701`) |
| box provenance | `RELEASE.json` source_commit `99f81731a69182098cfa49fd2293394c64f68d63` == main merge commit; build_id == `.next/BUILD_ID` |
| served build | `/login` **200**, embeds `e1I15X2aClu1mW4QksVz2` once and the old BUILD_ID 0 times; `/api/health` **200** (`ac-smoke.log`, 03:16:52Z) |
| webhook | unsigned empty `POST /api/webhooks/whatsapp` → **401** (rejected before any processing; nothing sent or stored) |
| processes | app 3531138 → **3545420**, worker 3531178 → **3545481**: both changed; at 03:20:07Z the same pids, up 3m43s / 3m37s (no restart) |
| worker | `Workers started: … agent-reply`; 0 lines after it at 03:20:07Z |
| app log, ≥3 min after restart | 6 lines after the `▲ Next.js` banner (`box-stability.log`): Local/Network, `✓ Ready`, `Running next.config.ts`, the known `"next start" does not work with "output: standalone"` warning, and **1 × `[AgentBooking] rate limiter unavailable, allowing: Error`** (pre-existing, see Exception) |
| prod DB read (BOOK-006 read shape) | Forge site command 14469968 → Supabase Management API read-only endpoint, project `uzimqndenngebzgndlhd`, token `SUPABASE_ACCESS_TOKEN` from the site `.env` (never printed): `select id, replaces_booking_id from booking_requests where restaurant_id = <omc> and status = 'pending'` → **HTTP 201, 3 rows, 1 with `replaces_booking_id` set** (03:18:06Z, `ac4-db-read.log`; counts only). So omc has one open change-request pair right now: the case BOOK-006 renders as one decision |
| box after | MemAvailable 2,391 MB, swap 94 MB free, disk 26,920 MB free, load 0.90 |
| not run | the BOOK-006 screen itself (needs a tenant login): the owner's live check on omc's bookings page |

### Exception: `[AgentBooking] rate limiter unavailable, allowing: Error` (not a BOOK-006 regression)
- `box-ratelimiter-line.log` (03:17:33Z): the app log holds 6 such lines, at log lines 19755, 20045, 20146, 22013,
  22210 and 22223. Five of them were written under earlier builds; 22210 sits after the AGENT-004 banner (22200), so
  the AGENT-004 build logged it too, after that run's stability check.
- Source: `withinWindow()` in `src/application/booking/create-agent-booking.ts` (the BOOK-003 agent-booking create
  path, poppy.json), which fails open when `RateLimiterPort.incrWindow` throws; `submit-booking-request.ts` (BOOK-001)
  has the same fail-open pattern. The throw comes from the limiter adapter, which BOOK-006 does not change. (BOOK-006
  adds code to `src/domain/entities/booking-request.ts`, from which this file imports only constants and a type.)
- The line logs only the error class (`Error`), by design (R37), so the log does not say why `incrWindow` failed.
  `redis-cli ping` on the box answers `PONG`, so Redis itself is up. Not investigated further here (read-only scope).
- Effect: the limiter allows the request when it can't count it. No user-facing failure.

## Rollback (ready, NOT executed; ETR ≈ 3 min)
Code-only: no migration to revert. Back to the AGENT-004 release (`e5ddd701` = `main@4af4caaf`, BUILD_ID
`zzJgH7D65-G0P4rKNa3uS`). This is a force-push to `release` and **needs Xavier's OK**:
```
# from any worktree of this repo (local refs are shared)
rtk proxy git push --force origin release-backup-e5ddd70:refs/heads/release
git ls-remote origin refs/heads/release      # must read e5ddd701443406910f20eab8ae4f12a63e09f37f
# Forge redeploys: RELEASE.json source_commit 4af4caaf, BUILD_ID zzJgH7D65-G0P4rKNa3uS, both pids change, /api/health 200.
```
If the local ref is gone, force-push by SHA `e5ddd701443406910f20eab8ae4f12a63e09f37f`. After a rollback the original
booking and its change request show as two independent pending rows again, each with Confirm/Decline (the
pre-BOOK-006 behaviour); no data is affected.

## Cleanup
| item | state |
|---|---|
| remote `rel-book006` | deleted after the deploy; `ls-remote origin refs/heads/rel-book006` empty |
| local branch `rel-book006` | deleted (`git branch -D`) |
| local ref `release-backup-e5ddd70` | kept as the rollback handle (not pushed) |
| `origin/release` `e5ddd701` → `8de9aea6` | replaced (force-push by `release.sh`, by design) |
| box | nothing created (read-only site commands; temp file in `/tmp` removed by the same command) |
| worktree `--release-book006` | removed after the docs PR was pushed (see handoff) |
| worktrees `--book-006`, `--book-007` | untouched (per brief) |
