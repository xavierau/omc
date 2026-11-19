---
id: deploys/2026-11-19-book-003-release-runbook
type: deploy
author: dev
created: 2026-11-19
status: executed
supersedes: null
superseded_by: null
related: [kanban:BOOK-003, github:186, github:192, github:193, artifacts/2026-11-19-book-003-release-handoff, plans/2026-11-19-agent-booking-poppy, threats/2026-11-19-agent-booking-poppy, deploys/2026-11-19-agent-001-book-release-runbook]
---

# Deploy: BOOK-003 agent booking API (dark): `main` @ `45a1023` to production

**Outcome: DEPLOYED 2026-11-19 08:20Z, dark. Migration 084 applied. Every read-only smoke check PASSES.** Prod
serves `main@45a10231`, release **`da99e4d4`**, BUILD_ID **`4VXrhhE4uWnAnm-o-34bu`**. App pid **3129673**
(next-server; supervisor 3129625), worker pid **3129734**. **0 of 7 restaurants have agent booking enabled** (none
has an `agentBooking` key at all). No test tenant, no DNS change, no WhatsApp message.

Stage: POC (the repo does not import `stages/mature.md`). Hosting: the existing Forge box; the `fly-deploy` and
Cloudflare rules do not apply. Go: Xavier 2026-11-19, "ok, merge and release when ready", relayed by main.
**Public repo:** `gh repo view` reports `xavierau/omc` as PUBLIC. The standing push exception does not cover public
repos, so pushes were held until main relayed the owner's ruling (2026-11-19): continue the release on the public
repo.

## Scope
- `origin/main..origin/develop` before this run: **`230a61be`** (BOOK-003, PR #186 squash) plus the AGENT-001 docs
  PRs #190 / #191 (workspace only).
- PR **#186**: the signed-out agent API (`POST /api/poppy/{publicId}/bookings`,
  `GET …/bookings/{id}`, `GET …/openapi.json`), the WhatsApp confirm-code promotion in the webhook, admin settings
  (`PUT /api/dashboard/settings/booking/agent`, `POST …/agent/rotate`, `GET …/poppy-json`), exclusions of
  `unverified` rows from the staff list and reminders. Migration **084_agent_booking**.
- **Conflict and fix.** The first release check (`git merge-tree origin/main origin/develop`) conflicted in
  `.claude-workspace/poc-log.md`. main carried three direct docs commits (`fd36b458`, `cc958557`, `0a838229`,
  BOOK-001/002 release records) that never went back to develop, and develop had appended lines after the same
  poc-log line. Escalated per brief; main approved the fix:
  - PR **#192** (`chore/sync-main-into-develop-book003` → develop, **merge commit**, not squash): `f8a0a071` merges
    `origin/main` into `origin/develop`. poc-log keeps main's three BOOK-001/002 lines then develop's BOOK-003 and
    AGENT-001 lines; develop's stale "not deployed" BOOK-001 line is dropped. Diff vs develop: 6 `.claude-workspace/`
    files, 0 code files; `origin/main` became an ancestor; 0 of main's poc-log lines missing. CodeRabbit pass
    (skipped for base). develop → **`7d4decf6`**.
  - Release PR **#193** (develop `7d4decf6` → main): MERGEABLE/CLEAN, CodeRabbit pass, merged `--merge
    --match-head-commit 7d4decf6`. Merge commit **`45a10231a3efc686ea40d5a36e0c47a6bd6b8d31`** at 07:42:50Z.
    `src supabase scripts package.json package-lock.json deploy.sh` equal develop `230a61be`; main and develop
    `7d4decf6` trees identical.
- `package.json` and the lockfile are unchanged against the previous prod (`091b36ba`): deploy.sh skips `npm ci` on
  the box. Only `supabase/migrations/084_agent_booking.sql` changed among migrations/scripts/deploy.sh.
- Cron: **no new Forge Scheduled Job.** `/api/cron/booking-reminders` (job 2216322, */5) now also deletes unverified
  agent bookings older than 1 h (`unverifiedDeleted` in its response).
- Target: `https://app.ohmyclient.io`, Forge server 1149990 / site 3123752 (`forge@34.158.58.133`), checkout
  `/home/forge/app.ohmyclient.io` on `release`. Supabase prod `whatsapp-crm-pro` (`uzimqndenngebzgndlhd`).
- Previous prod: `main@091b36ba`, release **`55995fa2`**, BUILD_ID `iOPJoRj0NXfsHDLCC1TO3`, pids 3027483 / 3027518.
- Executed from a fresh detached worktree `/Users/xavierau/Code/js/whatsapp-crm--release-book003` (at `230a61be`),
  `.env.local` and `.env.production.local` copied in (byte-identical, gitignored, never committed). The primary
  checkout and `--book-003` were not touched (apart from `wt-finish`, below).

## Pre-Flight
- [x] **Gate** on develop `230a61be` under the heavy lock, fresh `npm ci` (exit 0), 07:17–07:20Z: `tsc --noEmit`
      exit 0; `vitest run` exit 0, **642 files passed / 11 skipped, 7,202 tests passed, 79 skipped, 2 todo**. Exit
      codes read from files (`evidence/2026-11-19-book-003-release/ac1-*`). The released tree differs from it only in
      `.claude-workspace/`.
- [x] **Backup (07:19:50Z, before any DB change).** Managed physical backup **2306777673 COMPLETED
      2026-11-18T19:32:11Z** (7 dailies, WAL-G on, PITR off). Box `/home/forge/backups/2026-11-19-book-003/`
      (700, files 600):
      | file | content | sha256 |
      |---|---|---|
      | `managed-backups.json` | backup list | `f9e37b6ef0a2f4bf397e311bc559e0de0da005197494fca66598107cb08918c1` |
      | `restaurants.json` | full rows, 7 | `f0d8132947972a41dc60b1e6759e9e116c7e9db89a95608cc40159a562ee0935` |
      | `booking_requests.json` | full rows, 0 | `bac91a18eb4d2e458d3e50f48b7646cf67a04fa550bc023749945819753bee1f` |
      | `baseline-catalog.json` | catalog | `635e1aad898a8bdd31b56a3734d2b44223e40e8075169fe00934f24028555ae3` |
      Baseline: ledger tail 080–**083**, no 084; `booking_requests` status CHECK (pending, confirmed, declined),
      source CHECK (chat, campaign), `decision_consistent` = `(status = 'pending') = (decided_at IS NULL)`;
      `promote_agent_booking` absent; `restaurants_agent_booking_public_id_idx` absent; 0 restaurants with an
      `agentBooking` key; restaurants 7 / booking_requests 0 / members 4,227.
- [x] **Env, by name only (AC-6).** `.env.production.local` (used for the build; Next loads it before `.env.local`):
      `NEXT_PUBLIC_APP_URL` present, host **app.ohmyclient.io**; `APP_URL` host app.ohmyclient.io. The box `.env`:
      `NEXT_PUBLIC_APP_URL` host app.ohmyclient.io, `SUPABASE_ACCESS_TOKEN` set (len 44), `CRON_SECRET` set (len 64).
      **`NEXT_PUBLIC_PRIVACY_URL` absent** in both local env files and the box `.env`, so `booking-deps.ts` uses its
      default `https://ohmyclient.io/privacy-policy.html`.
- [x] **Box (07:17Z).** Disk 27,479 MB free, MemAvailable 2,252 MB, swap 148 MB free (idle), load 0.25. Not pinned;
      the build is off-box and `npm ci` is skipped.
- [x] **Restore point.** `origin/release` (`55995fa2`) fetched as the local ref **`release-backup-55995fa`** (not
      pushed).

## Runbook (as executed, UTC)
```
cd /Users/xavierau/Code/js/whatsapp-crm
rtk proxy git worktree add --detach ../whatsapp-crm--release-book003 230a61be
cp .env.local .env.production.local ../whatsapp-crm--release-book003/
cd ../whatsapp-crm--release-book003
resource-lock.py heavy -- bash -c 'npm ci; npx tsc --noEmit; npx vitest run'             # all exit 0
# backup + catalog: Management API from the box (helper reads the token from the site .env; helper deleted after)
rtk proxy git merge-tree --write-tree origin/main origin/develop                        # CONFLICT poc-log.md → escalated
rtk proxy git checkout -b chore/sync-main-into-develop-book003 origin/develop
rtk proxy git merge --no-ff origin/main                                                  # poc-log resolved → f8a0a071
rtk proxy git push -u origin chore/sync-main-into-develop-book003                        # ls-remote f8a0a071 ✓
gh pr create --base develop …; gh pr merge 192 --merge --match-head-commit f8a0a071…     # develop 7d4decf6
gh pr create --base main --head develop; gh pr merge 193 --merge --match-head-commit 7d4decf6…   # main 45a10231 ✓
python3 ~/.claude/bin/wt-finish /Users/xavierau/Code/js/whatsapp-crm--book-003            # REFUSED (see Cleanup)
rtk proxy git fetch origin refs/heads/release:refs/heads/release-backup-55995fa
rtk proxy git checkout -B rel-book003 origin/main; rtk proxy git push -u origin rel-book003      # ls-remote 45a10231 ✓
SOURCE_REF=rel-book003 resource-lock.py heavy -- bash scripts/release.sh                 # exit 0 (queued ~20 min on the lock)
git ls-remote origin refs/heads/release                                                  # da99e4d4 ✓ (was 55995fa2)
# Forge auto-deploy of `release`: deploy.sh → supabase db push (084) → restart app + worker
rtk proxy git push origin --delete rel-book003                                           # ls-remote empty ✓
```
release.sh tail:
```
→   BUILD_ID 4VXrhhE4uWnAnm-o-34bu
→ Scanning bundle for inlined credentials →   clean
 + 55995fa2...da99e4d4 da99e4d46890e407a4a94f9ca0a1b5d5fe84b8df -> release (forced update)
✓ Released rel-book003 @ 45a1023 → origin/release (da99e4d)
```
**Migration ordering.** As for 082 and 083, 084 was applied by deploy.sh's `supabase db push --linked --include-all`,
which runs after the checkout sync and before both daemon restarts and writes the ledger row. Not applied by hand.
The deploy.sh console output was not captured; the ledger and catalog below are the proof.

## Deploy facts
| time (UTC) | event |
|---|---|
| 07:42:50 | main merge commit `45a10231` (PR #193) |
| 08:16:24 | bundle built on the Mac (`RELEASE.json.built_at`, node v22.21.1) |
| ~08:19:30 | `release` force-pushed → `da99e4d4` |
| ≤08:20:04 | box checkout at `da99e4d4`; `RELEASE.json` source_ref `rel-book003`, source_commit `45a10231…`, build_id `4VXrhhE4uWnAnm-o-34bu` == `.next/BUILD_ID`; only dirt ` M supabase/.temp/cli-latest` (pre-existing) |
| 08:20:04 | app daemon-746791 → supervisor pid 3129625, **next-server 3129673** (`✓ Ready in 708ms`) |
| 08:20:07 | worker daemon-801730 → **pid 3129734**; `Workers started: campaign, event-dispatch, receipt, email-send, integration-inbound, integration-outbound, agent-reply` |

## Migration 084 result (read-only, Management API from the box, 08:21:54Z)
| check | result |
|---|---|
| ledger | `081`, `082`, `083`, **`084` (agent_booking)** |
| status CHECK | `status IN ('unverified','pending','confirmed','declined')` |
| source CHECK | `source IN ('chat','campaign','agent')` |
| decision constraint | `booking_requests_decision_consistent`: `(status IN ('unverified','pending')) = (decided_at IS NULL)` |
| new CHECKs | `booking_requests_unverified_has_code`, `_confirm_code_check` (`^[2-9A-HJ-NP-Z]{6}$`), `_status_token_hash_check` (`^[0-9a-f]{64}$`), `_idempotency_key_check` (1–255 chars) |
| new columns | `confirm_code` text, `verify_expires_at` timestamptz, `verified_at` timestamptz, `verified_wamid` text, `status_token_hash` text, `idempotency_key` text |
| new indexes | `booking_requests_restaurant_idempotency_key_idx`, `booking_requests_restaurant_confirm_code_idx`, `booking_requests_unverified_created_idx`; **`restaurants_agent_booking_public_id_idx`** (unique, partial) |
| function | `promote_agent_booking(uuid, text, text[], text, timestamptz, integer)` exists; EXECUTE: anon **false**, authenticated **false**, service_role true |
| row counts | restaurants 7, booking_requests 0, members 4,227: unchanged from the 07:19Z baseline |
| agent booking | **0** restaurants with an `agentBooking` key, **0** with `enabled = true` |
Box files: `after-catalog.json` (sha256 `9241174c99a924da…`), `after-extra.json` (`35406a62847818ea…`), both 600.

## Post-Deploy Verification (read-only, unauthenticated, no data created; ALL PASS)
Random ids: publicId `9b5fb710b27f5f22481bf59d`, booking uuid `360456f9-b39e-4bec-bc8f-0cad2ecb73fc`.
| check | result |
|---|---|
| `POST /api/poppy/<id>/bookings` | **404** `application/json` `{"error":"not_found",…}`, `cache-control: no-store, max-age=0`, `referrer-policy: no-referrer` |
| `GET /api/poppy/<id>/openapi.json` | **404** JSON, same two headers |
| `GET /api/poppy/<id>/bookings/<uuid>` | **404** JSON, same two headers |
| `PUT /api/dashboard/settings/booking/agent` | **401** `{"error":"Unauthorized"}` |
| `POST …/booking/agent/rotate` | **401** |
| `GET …/booking/poppy-json` | **401** |
| existing | `/api/health` 200, `/login` 200, `/api/cron/booking-reminders` **401** without bearer |
| served build | `/login` embeds `4VXrhhE4uWnAnm-o-34bu` once and the old BUILD_ID 0 times |
| cron | job 2216322 tick **08:25:01Z** → 200 `{"candidates":0,"due":0,"sent":0,"notDelivered":0,"claimLost":0,"unverifiedDeleted":0}` (the 07:20Z tick before the deploy had no `unverifiedDeleted`, so the new code answered) |
| stability | 08:25:31Z: next-server 3129673 elapsed 5:27, worker 3129734 uptime 5:24, no restart |
| logs | app since `Ready`: 0 fatal/uncaught/unhandled/missing-module lines (known standalone warning only); worker since the start banner: 0 |
| box after | disk 27,462 MB free, MemAvailable 2,318 MB, swap 165 MB free, load 0.55 |
| not run | authenticated UI, any tenant login, enabling agent booking, any send |

**Seen, not an AC failure:** the first `POST /api/poppy/…/bookings` after the restart logged
`[AgentBooking] rate limiter unavailable, allowing: Error` once; two later probes did not. The same fail-open
warning from BOOK-001's `[Booking]` limiter appears 3 times in the older app log. The limiter fails open by design
(caps and the WhatsApp proof still bound abuse), so the first request after a restart is not rate limited.

## Rollback (ready, NOT executed; ETR ≈ 1–2 min)
1. **Agent booking is already off everywhere**; nothing to switch off.
2. **Code** to the AGENT-001 release (`55995fa2` = `main@091b36ba`, BUILD_ID `iOPJoRj0NXfsHDLCC1TO3`):
   ```
   cd /Users/xavierau/Code/js/whatsapp-crm       # local refs are shared by every worktree of this repo
   rtk proxy git push --force origin release-backup-55995fa:refs/heads/release
   git ls-remote origin refs/heads/release       # must read 55995fa28d21efcff85e0ab7809caf0528693f34
   # Forge redeploys: RELEASE.json source_commit 091b36ba, both pids change, /api/health 200,
   # /api/poppy/x/bookings back to a non-JSON 404/307.
   ```
   If the local ref is gone, force-push by SHA `55995fa28d21efcff85e0ab7809caf0528693f34`.
3. **084 is additive and stays.** Old code never writes `unverified`/`agent` rows and ignores the new columns, the
   function and the index. A DB revert is a separate owner decision (drop the function, the 4 indexes, the 6 columns
   and the new CHECKs, restore the three old CHECKs, delete the `084` ledger row; `booking_requests.json` and
   `restaurants.json` on the box are the row copies).
4. Job 2216322 stays: the old code serves the same route without the purge step.

## Cleanup
| item | state |
|---|---|
| remote `rel-book003` | deleted 08:27Z; `ls-remote origin refs/heads/rel-book003` empty |
| remote `chore/sync-main-into-develop-book003` | kept (merged as #192) |
| local ref `release-backup-55995fa` | kept as the rollback handle |
| `origin/release` `55995fa2` → `da99e4d4` | replaced (force-push by design) |
| box `/home/forge/rel-book003-tmp/` (helper + SQL) | deleted |
| box `/home/forge/backups/2026-11-19-book-003/` | kept; delete once the release is accepted |
| worktree `--book-003` (`feature/book-003-agent-booking`) | **kept**: `wt-finish` (no `--force`) refused, exit 1: `feature/book-003-agent-booking has 42 commit(s) not in main` (PR #186 was squash-merged). Removal is main's call |
| worktree `--release-book003` | `wt-finish` run after the docs PR merged; result in the handoff |
