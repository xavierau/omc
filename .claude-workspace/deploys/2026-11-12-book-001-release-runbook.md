---
id: deploys/2026-11-12-book-001-release-runbook
type: deploy
author: dev
created: 2026-11-12
status: executed
supersedes: null
superseded_by: null
related: [kanban:BOOK-001, github:178, github:179, artifacts/2026-11-12-book-001-rel-handoff, deploys/2026-11-05-camp-014-release-runbook, deploys/2026-10-07-mem-001-004-release-runbook]
---

# Deploy: BOOK-001 restaurant booking (dark): `main` @ `7ccf66e` to production

**Outcome: DEPLOYED 2026-11-12 14:58Z. Migration 082 applied. Both Forge jobs are created and running. Every read-only
smoke check PASSES.** Prod serves `main@7ccf66e0`, release `034998b`, BUILD_ID `7umNlW5VKJJkTi6w2JwzR`. Both daemons
restarted: app pid 3850736, worker pid 3850810. `/api/health` returns 200.

The release shipped with booking Off for every restaurant. **Post-deploy observation:** at 14:59:28Z, about a minute
after the restart, someone saved booking settings for the **OhMyClient** tenant (`2e578557…`) in Simple mode from
the dashboard. dev did not do this; the actor is unconfirmed, and dev only read the database. That save submitted
8 booking UTILITY templates to Meta. Meta rejected 6 with subcode 2388293 "Params Words Ratio Exceeds Limit"
(booking_confirmed, booking_declined and booking_reminder, en and zh_HK). 2 are pending (booking_received, en and
zh_HK). No booking, token or classification row exists. See Findings.

Stage: POC (the repo does not import `stages/mature.md`). Hosting: the existing Forge box. The `fly-deploy` and
Cloudflare rules do not apply.

## Scope
- PR **#178** (`feature/book-001` → develop, squash **`dd7fcd53`**): restaurant booking. It covers the Simple and
  External modes, Book now campaigns, free-text and BOOK routing, staff confirm/decline, and the reminder and
  retention crons. Migration **082_booking**.
- Conflict fix on develop: **`c34011ae`** "chore: merge main into develop before BOOK-001 release". This merges
  origin/main `bfb09dc7` into develop with a merge commit, not a squash or rebase.
  - Only `.claude-workspace/poc-log.md` conflicted (add/add). It was resolved as the union of main's MEM-001 and
    CAMP-014 lines and develop's BOOK-001 line, in date order.
  - Gates passed before the commit: 0 `U` entries and 0 conflict markers.
  - `git diff origin/main..<merge> -- poc-log.md` shows 0 removed lines, and every main and develop line is present
    verbatim (checked by content with `grep -xF`).
  - `INDEX.md` and `kanban.json` auto-merged (kanban is valid JSON). The merge changed no code relative to develop
    (`src supabase scripts deploy.sh package*` diff empty).
- Release PR **#179** (develop `c34011ae` → main): merged with a merge commit, **`7ccf66e0855fe582d814a73d81c3dbb092654139`**,
  at 14:54:06Z. It was MERGEABLE/CLEAN, and `ls-remote` verified main. main contains `dd7fcd53` and `bfb09dc7`, and
  `git diff origin/main origin/develop` is empty.
- `package.json` and the lockfile are unchanged against the previous prod, so deploy.sh skipped `npm ci`.
  `supabase/migrations` adds only `082_booking.sql`.
- Target: `https://app.ohmyclient.io` on Forge server 1149990 / site 3123752 (`forge@34.158.58.133`), checkout
  `/home/forge/app.ohmyclient.io` on `release`.
- Previous prod: `main@84f46297`, release **`b0b4ef0`**, BUILD_ID `THI1PO_omqiN4JkzDp8Ly`, pids 78688 / 78805.
- Executed from worktree `/Users/xavierau/Code/js/whatsapp-crm--release-book001`. `.env.local` and
  `.env.production.local` are byte-identical to the primary's, gitignored and never committed. The primary checkout
  and the other worktrees were not touched. Go: the owner's "merge to main and then deploy" (2026-11-12), relayed by
  the main thread.

## Pre-Flight
- [x] **Gate**: develop tip `dd7fcd53`, r1, 14:55Z. Both `vitest run` and `tsc --noEmit` exited 0
      (`artifacts/2026-11-12-book-001-rel-handoff`). The release tree differs from it only in workspace docs.
- [x] **Backup, re-confirmed at 14:54Z.** Managed physical backup **2236199520** is COMPLETED (2026-11-11T19:32:05Z;
      7 dailies; WAL-G on, PITR off). The box holds `/home/forge/backups/2026-11-12-book-001/` (700, files 600):
      - row exports `restaurants.json` (7 rows) and `campaigns.json` (46 rows);
      - `baseline-catalog.json`;
      - `managed-backups.json`;
      - `env-before`.
- [x] **Catalog before.** The ledger max is `081`. `booking_tokens`, `booking_requests` and `inbound_classifications`
      are absent, as are `restaurants.booking_config` and `booking_reminder_candidates`.
- [x] **Env, by name only (r1).**
      - `GEMINI_API_KEY` was set in r1; hash verified.
      - `CRON_SECRET` and `APP_URL` are present. The wrapper reached the cron routes with them (HTTP 200).
      - `NEXT_PUBLIC_APP_URL` is present.
- [x] **Box memory (14:54Z, and again at 14:57Z just before the deploy).**
      - MemAvailable 658 MB, swap 1,021/1,023 MB used, load 0.22, disk 27,851 MB free.
      - The build runs off-box (release.sh on the Mac) and the lockfile is unchanged, so the box only ran `db push`,
        the seeder and two restarts. This is the MEM-001 precedent (476 MB available), so it was judged not to need
        escalation.
- [x] **Public baseline.** `/b/<random>`, `POST /api/b/<random>` and both `/api/cron/booking-*` routes returned 404.
      `/api/health` and `/login` returned 200.
- [x] **Restore point.** `origin/release` (`b0b4ef04`) is fetched as the local ref **`release-backup-b0b4ef0`**
      (not pushed).

## Runbook (as executed, UTC)
```
cd /Users/xavierau/Code/js/whatsapp-crm--release-book001
rtk proxy git checkout -B develop origin/develop
rtk proxy git merge --no-ff --no-commit origin/main         # conflict: poc-log.md only
# poc-log.md = main blob + develop's BOOK-001 line; gates: 0 U, 0 markers, 0 removed lines
rtk proxy git commit                                        # c34011ae
rtk proxy git push origin develop                           # ls-remote c34011ae ✓
gh pr merge 179 --merge                                     # 14:54:06Z → 7ccf66e0 (ls-remote ✓)
rtk proxy git checkout -B release-book001 origin/main
rtk proxy git fetch origin refs/heads/release:refs/heads/release-backup-b0b4ef0
rtk proxy git push origin release-book001:refs/heads/release-book001   # ls-remote 7ccf66e0 ✓
SOURCE_REF=release-book001 resource-lock.py heavy -- bash scripts/release.sh   # exit 0
git ls-remote origin refs/heads/release                     # 034998bb ✓ (was b0b4ef04)
# Forge auto-deploy 82824664: deploy.sh → supabase db push (082) → seed → restart
POST /api/orgs/<org>/servers/1149990/scheduled-jobs ×2      # 2216322, 2216323
rtk proxy git push origin --delete release-book001          # ls-remote empty ✓
```
release.sh tail:
```
→   building release-book001 @ 7ccf66e
→   BUILD_ID 7umNlW5VKJJkTi6w2JwzR
→ Scanning bundle for inlined credentials →   clean
 + b0b4ef04...034998bb 034998bb5234961d611e9b33909050a3d912bc5a -> release (forced update)
✓ Released release-book001 @ 7ccf66e → origin/release (034998b)
release.sh exit=0
```
`RELEASE.json.source_ref` reads `release-book001`, the temp branch. `source_commit` is the real main tip.

## Deploy facts (Forge auto-deploy of `release`, deployment **82824664**)
| time (UTC) | event |
|---|---|
| 14:56:16 | bundle built (`RELEASE.json.built_at`, node v22.21.1) |
| 14:57:19 | Forge deployment 82824664 started (commit `034998bb`) |
| ~14:57:50 | checkout synced. Disk 27,833 MB free. `lockfile unchanged (5b141452304d) — skipping npm ci` |
| ~14:57:55 | `supabase db push`: `Applying migration 082_booking.sql... Finished supabase db push.` |
| ~14:58:05 | app daemon-746791 → **pid 3850736**, worker daemon-801730 → **pid 3850810**, both RUNNING. `✓ Deploy complete` |
| 14:58:11 | deployment `finished` |

## Migration 082 result (read-only checks, Management API from the box)
| check | result |
|---|---|
| ledger | `080 member_delivery_quality`, `081 event_type_reachability_restored`, **`082 booking`** |
| tables | `booking_tokens`, `booking_requests` and `inbound_classifications` exist, RLS enabled on all three, 0 rows each |
| `restaurants.booking_config` | `jsonb NOT NULL DEFAULT '{"mode": "off"}'`. At 14:58:20Z, 0 of 7 restaurants were not `off` (OhMyClient changed at 14:59:28Z, see Findings) |
| `campaigns.book_now_enabled` / `booking_url` | `boolean NOT NULL DEFAULT false` / `text NULL`. 0 of 46 campaigns are true |
| function | `booking_reminder_candidates(timestamptz,integer,integer)`, not SECURITY DEFINER, ACL **`{postgres=X/postgres,service_role=X/postgres}`**: service_role only (anon/authenticated/PUBLIC revoked) |
| row counts | restaurants 7, campaigns 46 and members 4,189 are unchanged from the r1 baseline |

## Forge Scheduled Jobs (server-level, user `forge`, as 2090251–2090253)
| id | cron | command | status |
|---|---|---|---|
| **2216322** | `*/5 * * * *` | `bash /home/forge/app.ohmyclient.io/scripts/cron/booking-reminders.sh` | installed |
| **2216323** | `30 3 * * *` | `bash /home/forge/app.ohmyclient.io/scripts/cron/booking-retention.sh` | installed |

Manual run on the box at 14:59:08Z. Both wrappers exited 0; the wrapper exits non-zero on anything other than 2xx.
- booking-reminders returned `{"candidates":0,"due":0,"sent":0,"notDelivered":0,"claimLost":0}`.
- booking-retention returned `{"purged":0,"cutoffDate":"2026-05-16"}`.

The explicit status with the bearer (secret read on the box and never printed) was HTTP **200** for both routes.
Scheduler proof: Forge's output for 2216322 shows the 15:05:01Z tick with the same zero-work JSON.

## Post-Deploy Verification (read-only, unauthenticated, no data created; ALL PASS)
| check | result |
|---|---|
| provenance | RELEASE.json `source_commit 7ccf66e0…` == main tip, `build_id 7umNlW5VKJJkTi6w2JwzR` == `.next/BUILD_ID`; HEAD `034998bb`. The only dirt is ` M supabase/.temp/cli-latest`, which was there before |
| daemons | RUNNING pids 3850736 / 3850810 (were 78688 / 78805). The other 2 supervisor programs on the box are untouched |
| served build | `/login` embeds the new BUILD_ID once and the old one zero times. The referenced chunk `/_next/static/chunks/3yfl9fgvivx3-.js` returns **200** (the #56 failure mode is absent) |
| `GET /b/<random 43-char>` | **200** with the not-recognised page (`<title>Booking</title>`, `data-testid="booking-unavailable"`). Headers: `Cache-Control: no-store, max-age=0`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow` |
| `POST /api/b/<random>` | **410** `{"error":"token_unusable","state":"unknown"}` |
| cron routes without a bearer | `/api/cron/booking-reminders` and `/api/cron/booking-retention` both return **401**. A bad bearer also gets 401 |
| existing routes | `/api/health` 200, `/login` 200, `/` 307. Unauthenticated `POST …/campaigns/<zero-uuid>/rerun` returns 401, as before |
| webhook (14:58–15:05Z) | No real inbound webhook arrived. This matches the overnight pattern: 1–7 an hour at 14:00Z yesterday and today; the last real one was 14:28:58Z. An unsigned probe `POST /api/webhooks/whatsapp` at 15:05:40Z was logged as `webhook.received` + `webhook.signature {valid:false}` and got 401, so the logging and signature path is live. `booking.classified` appears **0** times in the webhook log and the app log |
| logs | app: `✓ Ready in 518ms` plus the existing standalone warning. Worker: all 6 queues started. 0 fatal, uncaught, unhandled or missing-module lines. No Redis errors |
| box after | MemAvailable 2,303 MB, swap free 139 MB, load 0.89, disk 27,832 MB free |
| authenticated UI smoke | **NOT RUN** by design: no tenant login, no booking, no send |

## Findings (for the owner; nothing rolled back, since existing traffic is unaffected)
1. **OhMyClient booking switched on after the release, not by dev.** `restaurants.booking_config.mode = simple` for
   `2e578557…` "OhMyClient" since 14:59:28Z, saved through `PUT /api/dashboard/settings/booking`, which runs template
   provisioning. Who saved it is unconfirmed.
2. **Meta rejected 6 of the 8 booking templates** with subcode 2388293 "Params Words Ratio Exceeds Limit" ("too many
   variables for its length"). Rejected: booking_confirmed_4b3216, booking_declined_6b52ab, booking_reminder_75c8b4,
   each in en and zh_HK. Pending: booking_received_672cad (en, zh_HK).
   - Without approved confirmed/declined/reminder templates, those messages cannot reach a diner outside the 24-hour
     window.
   - The template copy in `src/domain/services/booking-templates.ts` needs more words per variable. Each new save
     mints new names and resubmits the rejected ones.
3. **One `[Booking] rate limiter unavailable, allowing: Error` at boot.** It came from the first `POST /api/b` after
   the restart, which fails open by design. A repeat POST did not log it, Redis answers PONG, and the app log has no
   Redis errors. This was most likely the first request racing the Redis handshake (unconfirmed).

## Rollback (ready, NOT executed; ETR ≈ 1–2 min)
1. Redeploy the previous bundle, release `b0b4ef0` (= `main@84f46297`, BUILD_ID `THI1PO_omqiN4JkzDp8Ly`):
   ```
   cd /Users/xavierau/Code/js/whatsapp-crm       # local refs are shared by every worktree of this repo
   rtk proxy git push --force origin release-backup-b0b4ef0:refs/heads/release
   git ls-remote origin refs/heads/release       # must read b0b4ef045f8ae0bb1a2f3ed12355c05bc04ce990
   # Forge redeploys: RELEASE.json source_commit 84f46297, both pids change, /api/health 200,
   # /b/<x> and /api/cron/booking-* back to 404. deploy.sh's db push is a no-op (082 stays recorded).
   ```
   If the local ref is gone, force-push by SHA `b0b4ef045f8ae0bb1a2f3ed12355c05bc04ce990` from any clone that has it,
   or rebuild with `SOURCE_REF=<branch at 84f46297> bash scripts/release.sh`.
2. Disable the two jobs, which would otherwise fail every tick against a 404:
   `DELETE /api/orgs/<org>/servers/1149990/scheduled-jobs/2216322` and `…/2216323` (Forge API, curl UA).
3. **082 is additive and stays in place.** The old build ignores the new tables and columns, and the defaults are
   inert. A DB revert is a separate owner decision: drop the three tables, the function and the three columns, then
   delete the `082` ledger row, using the row exports on the box.
4. `GEMINI_API_KEY` (set in r1) can stay. To undo it, Forge env PUT from the box file `env-before`.
5. Booking templates already submitted to Meta for OhMyClient stay in its WABA whatever happens to the code.

Surface to the owner before rolling back unless service is down.

## Cleanup
| item | state |
|---|---|
| remote `release-book001` @ 7ccf66e0 | **deleted** (`ls-remote` empty) |
| local ref `release-backup-b0b4ef0` | kept as the rollback handle |
| `origin/release` `b0b4ef0` → `034998b` | replaced (force-push by design) |
| worktree `--release-book001` | kept until this runbook is pushed; remove afterwards |
| box `/home/forge/backups/2026-11-12-book-001/` | kept; delete once the release is accepted |

## Notes
- PR #179 shows no checks on the new develop head `c34011ae` (`gh pr checks`: none reported). CodeRabbit was SUCCESS
  on `dd7fcd53`; the merge commit changed workspace docs only.
- `BOOK-001` has no entry in `.claude/kanban.json` on develop or main, so the merge dropped nothing there and there was
  nothing to move to done.
- The primary checkout (`main` @ `fdbe34eb`, dirty) is behind `origin/main`.

## Release 2: booking template copy fix (#180), 2026-11-12 15:22–15:30Z (dev, BOOK-001-REL2)

**Outcome: DEPLOYED 15:26:33Z. No migration, no template submitted, no WhatsApp message sent. Every smoke check
PASSES.** Prod serves `main@1d398656`, release **`397bc643`**, BUILD_ID **`riN6cf7pnVy9Nari180qV`**. Go: the owner's
"deploy when green" (2026-11-12), relayed by the main thread. Next, the owner presses Save once in booking settings,
and that resubmits the rejected templates with the new copy.

- **PR #180** (`fix/booking-template-copy` @ `1d2d5ced` → develop): squash **`5da3eba5`** at 15:22:26Z. ls-remote
  develop = `5da3eba5`. Gate: F3 at `fbe05814`, `vitest run` and `tsc --noEmit` exit 0
  (`artifacts/2026-11-12-book-001-f3-handoff`). `git diff fbe05814 origin/main -- src supabase scripts package*` is empty.
- **PR #181** (develop → main, "release: booking template copy fix (#180)"): MERGEABLE/CLEAN, so no conflict
  resolution was needed. Merge commit **`1d3986567cbb14916623611b0321aa38ca3a36e5`** at 15:22:54Z. ls-remote main ✓.
  main contains `5da3eba5`, and main differs from develop only in workspace docs.
- Against prod `7ccf66e0`: no change to `supabase/`, `package*`, `scripts/` or `deploy.sh`.

```
cd /Users/xavierau/Code/js/whatsapp-crm--release-book001
gh pr merge 180 --squash --match-head-commit 1d2d5ced…              # 5da3eba5
gh pr create --base main --head develop; gh pr merge 181 --merge    # 1d398656
rtk proxy git fetch origin refs/heads/release:refs/heads/release-backup-034998b
rtk proxy git checkout -B release-book001 origin/main
rtk proxy git push origin release-book001:refs/heads/release-book001
SOURCE_REF=release-book001 resource-lock.py heavy -- bash scripts/release.sh   # exit 0, built on the Mac
git ls-remote origin refs/heads/release                     # 397bc643 ✓ (was 034998bb)
rtk proxy git push origin --delete release-book001          # ls-remote empty ✓
```
`release.sh`: `BUILD_ID riN6cf7pnVy9Nari180qV`, secret scan clean, `034998bb...397bc643 -> release (forced update)`.

| time (UTC) | event |
|---|---|
| 15:23:23 | box pre-flight. MemAvailable 2,309 MB, swap free 144 MB, load 0.08, disk 27,828 MB free. HEAD `034998bb`, BUILD_ID `7umNlW5VKJJkTi6w2JwzR`, pids 3850736 / 3850810 |
| 15:25:34 | bundle built on the Mac (`RELEASE.json.built_at`) |
| 15:25:47 | Forge deployment **82828241** started (`397bc643`) |
| — | `lockfile unchanged (5b141452304d) — skipping npm ci`. `supabase db push`: **Remote database is up to date** (no migration). Seed idempotent |
| — | app daemon-746791 → **pid 3863259**, worker daemon-801730 → **pid 3863333**, both RUNNING. `✓ Deploy complete` |
| 15:26:33 | deployment `finished` |

| smoke (15:26:59–15:30:02Z, read-only, unauthenticated) | result |
|---|---|
| provenance | HEAD `397bc643`. RELEASE.json `source_commit 1d398656…` == main tip, `build_id riN6cf7pnVy9Nari180qV` == `.next/BUILD_ID`. Only dirt: ` M supabase/.temp/cli-latest` (as before). Other 2 supervisor programs untouched |
| served build | `/login` embeds the new BUILD_ID once and the old one 0 times. Chunk `/_next/static/chunks/3yfl9fgvivx3-.js` returns 200 |
| `GET /b/<random 43-char>` | **200**, `<title>Booking</title>`, `data-testid="booking-unavailable"`, `Cache-Control: no-store, max-age=0`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow` |
| `POST /api/b/<random>` `{}` | **410** `{"error":"token_unusable","state":"unknown"}`. Without a body it is 400 `invalid_json`, same before and after |
| cron routes | `/api/cron/booking-reminders` and `/api/cron/booking-retention` return **401** without a bearer and with a bad bearer |
| existing | `/api/health` 200, `/login` 200, `/` 307 |
| Forge job 2216322 | the 15:30:01Z tick logged `{"candidates":0,"due":0,"sent":0,"notDelivered":0,"claimLost":0}`. `run-cron-endpoint.sh` prints the body only on 2xx (else `HTTP <code>` and exit 1), and the route's only 2xx is `NextResponse.json(…)` with default status 200, so this was **HTTP 200** |
| logs | app `✓ Ready in 219ms` plus the existing standalone warning. Worker: all 6 queues started, clean SIGTERM drain before. 0 fatal, uncaught, unhandled, missing-module or Redis-error lines. One `[Booking] rate limiter unavailable, allowing: Error` from the smoke's first POST after boot, as in Finding 3 |
| box after | MemAvailable 2,445 MB, swap free 144 MB, load 0.13, disk 27,827 MB free |
| not run | authenticated UI, booking settings Save, template submission, any send (owner resubmits) |

**Rollback to tonight's release** (ready, not executed; ETR ≈ 1–2 min). Release `034998b` = `main@7ccf66e0`, BUILD_ID
`7umNlW5VKJJkTi6w2JwzR`:
```
cd /Users/xavierau/Code/js/whatsapp-crm       # local refs are shared by every worktree of this repo
rtk proxy git push --force origin release-backup-034998b:refs/heads/release
git ls-remote origin refs/heads/release       # must read 034998bb5234961d611e9b33909050a3d912bc5a
# Forge redeploys; check RELEASE.json source_commit 7ccf66e0, both pids change, /api/health 200.
```
Keep the Forge jobs: the old build serves both cron routes. Templates already submitted to Meta stay in the WABA.
After a rollback, the old sender sends the old param set. A row submitted with the new copy would then miss or carry
extra params, so roll back before the owner's Save, or accept that the new-copy rows fail to send until a re-release.
