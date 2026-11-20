---
id: deploys/2026-11-20-agent-005-release-runbook
type: deploy
author: dev
created: 2026-11-20
status: executed
supersedes: null
superseded_by: null
related: [kanban:AGENT-005, github:216, github:219, artifacts/2026-11-20-rel-agent005-handoff, artifacts/2026-11-20-agent-005-handoff, plans/2026-11-20-agent-005-agent-skills, deploys/2026-11-20-book-008-release-runbook]
---

# Deploy: AGENT-005 agent skills + 訂座規則: `main` @ `fe1cdbfb` to production

**Outcome: DEPLOYED 2026-11-20 08:43Z (16:43 HKT). No migration.** Prod serves `main@fe1cdbfb`, release
**`d05e6470`**, BUILD_ID **`F2oHXhD6zjqi7IwuTmGfA`**. App next-server pid **3671054**, worker pid **3671113**
(`npm exec`). Every read-only check passes. In the 3m40s after the restart the app logged only the two known
`[Kapso] Error listing templates: WhatsApp configuration not found` lines (pre-existing, main ruling 2026-11-20).
There were no limiter lines and no other error line, and the worker logged nothing after `Workers started`. omc's
訂座規則 is still empty: its `booking_config` has no `bookingRules` key, and its `agent_config` is byte-identical
(rev 11). Until the owner fills the field, the booking skill checks requested times against the opening hours in
餐廳資料. The owner's live check is still to do.

Stage: POC (the repo does not import `stages/mature.md`). Hosting: the existing Forge box; the `fly-deploy` and
Cloudflare rules do not apply. Go: owner 2026-11-20 ("go 1 merge and release"), relayed by main. It covers the
develop → main merge and release.sh's force-push of `release`. Repo `xavierau/omc` is **public**: no tenant id,
user id, email, phone number, message text, config value or secret appears below or in the evidence (`built_by`, the
seeded admin email and its user id are redacted; omc's configs appear only as key counts and md5s). All times UTC.

## Scope
- `main` before: **`1f2b9eb4`** (BOOK-008 release). `main` now: **`fe1cdbfb`** = merge of release PR **#219**
  (develop `11e65e6e` → main). It brings:
  - `11e65e6e` AGENT-005 (PR #216 squash):
    - The reply agent's system instruction becomes core rules 1–5 plus one section per skill whose tools are offered
      for the job: loyalty (`get_member_summary`, `list_rewards`) and booking (the booking tools)
      (`src/application/agent/skills/*`, `agent-prompt.ts`, `process-agent-reply.ts`, `agent-booking-gate.ts`).
    - The booking skill checks a requested time against BOOKING RULES (`booking_config.bookingRules`, free text,
      max 2000 characters), else against the opening hours in the knowledge. If the time is outside them, the agent
      says so and suggests other times instead of proposing it.
    - Staff edit the field as 訂座規則 in Settings → Booking (`booking-settings-section.tsx`,
      `use-booking-settings.ts`, `booking-config.ts`, `en.json`/`zh-HK.json`), plus tests.
    - No migration: `bookingRules` is a key inside the existing `restaurants.booking_config` JSONB, and a missing
      key parses as `''`.
  - `4f10c539` BOOK-008 release records (#218): workspace docs only.
- Delta `1f2b9eb4..fe1cdbfb`: no file under `supabase/migrations`. No change to `package.json`,
  `package-lock.json`, any `.env*` file or any other `supabase/` path. Forge confirmed the lockfile was unchanged
  (`5b141452304d`).
- Target: `https://app.ohmyclient.io`, Forge server 1149990 / site 3123752, checkout
  `/home/forge/app.ohmyclient.io` on `release`. Supabase prod `whatsapp-crm-pro` (`uzimqndenngebzgndlhd`).
- Previous prod: `main@1f2b9eb4`, release **`d74942c1`**, BUILD_ID `Dy3BMrmauUbUY9gIzFdVI`, app pid 3661017,
  worker pid 3661081.
- Executed from a fresh detached worktree `/Users/xavierau/Code/js/whatsapp-crm--release-agent005` at `11e65e6e`.
  `.env.local` and `.env.production.local` were copied from the primary checkout (`cmp` identical, gitignored,
  never committed). The build ran on the Mac only. The primary checkout and every other worktree (including
  `--agent-005`) were not touched, and nothing was stashed.
- AGENT-005 was branched before BOOK-008 landed. The AC-1 gate on `11e65e6e` is the integration check of both.

## Pre-Flight
- [x] **Range** (08:34Z, re-checked 08:36:53Z just before the PR): `origin/develop` = `11e65e6e`;
      `origin/main..origin/develop` = `4f10c539`, `11e65e6e` only. `origin/main` `1f2b9eb4`, `origin/release`
      `d74942c1`.
- [x] **Gate** on `11e65e6e` under the heavy lock, 08:34:55–08:36:39Z. Exit codes are read from files
      (`artifacts/evidence/2026-11-20-agent-005-release/ac1-*`):
  - `npm ci` exit 0 (fresh tree, no `node_modules`).
  - `tsc --noEmit` exit 0 (empty log).
  - `vitest run` exit 0: **683 files passed / 14 skipped, 7,800 tests passed, 127 skipped, 2 todo**.
- [x] **Merge tree:** `git merge-tree --write-tree origin/main origin/develop` exit 0. The tree `b284303a` equals
      develop's tree.
- [x] **Box** (08:35:13Z, SSH read-only, `box-preflight.log`). This time SSH as `forge` was accepted, so no Forge
      site command was needed.
  - Release state: HEAD `d74942c1`, BUILD_ID `Dy3BMrmauUbUY9gIzFdVI`, RELEASE.json source_commit `1f2b9eb4`.
  - Processes: app 3661017 and worker 3661081, up 15m.
  - Resources: disk 27,029 MB free (deploy.sh floor 1,500 MB), MemAvailable 2,400 MB, swap 55 MB free, load 0.25.
  - The site `.env` has a non-empty `SUPABASE_ACCESS_TOKEN` and names project `uzimqndenngebzgndlhd` (1 line each).
- [x] **omc config baseline** (08:35:43Z, `omc-config-predeploy.log`): one read-only query through the Supabase
      Management API `/database/query/read-only`, run on the box. The token was read in-process from the site `.env`
      and passed to curl on stdin (`-K -`), never printed. It returned counts and hashes only:
  - `agent_config`: rev **11**, 20 keys, mode `auto`, md5 `cb96e1e4a9c5514f2f6e03de98bbad0b`.
  - `booking_config`: no `bookingRules` key, 11 keys, mode `simple`, md5 `540ec34c6c33cbd5277d9bf0e1a542f5`.
- [x] **No DB backup taken**: no migration and no data write in this release.
- [x] **Restore point.** `origin/release` (`d74942c1`) fetched as the local ref **`release-backup-d74942c`** (not
      pushed). The ref did not exist locally at the start, so this run created it.

## Runbook (as executed)
```
cd /Users/xavierau/Code/js/whatsapp-crm
rtk proxy git fetch origin
rtk proxy git worktree add --detach ../whatsapp-crm--release-agent005 11e65e6e
cp .env.local .env.production.local ../whatsapp-crm--release-agent005/                      # cmp identical
rtk proxy git fetch origin refs/heads/release:refs/heads/release-backup-d74942c              # d74942c1
# box pre-flight (SSH, read-only) 08:35:13Z; omc config baseline (read-only) 08:35:43Z
cd ../whatsapp-crm--release-agent005
resource-lock.py heavy -- bash -c 'npm ci; npx tsc --noEmit; npx vitest run'                 # 08:34:55–08:36:39Z, all exit 0
rtk proxy git merge-tree --write-tree origin/main origin/develop                            # exit 0, tree b284303a == develop
gh pr create --base main --head develop                                                     # #219 08:36:53Z, MERGEABLE/CLEAN, no checks
gh pr merge 219 --merge --match-head-commit 11e65e6e…                                       # 08:38:23Z → fe1cdbfb
rtk proxy git checkout -B rel-agent005 fe1cdbfb
timeout 120 rtk proxy git push origin rel-agent005:refs/heads/rel-agent005                   # ls-remote fe1cdbfb ✓
SOURCE_REF=rel-agent005 resource-lock.py heavy -- bash scripts/release.sh                   # exit 0, 08:38:39–08:42:37Z
git ls-remote origin refs/heads/release                                                       # d05e6470 ✓ (was d74942c1)
# Forge auto-deploy 83536518: deploy.sh → db push (nothing pending) → seed → restart app + worker
# post-deploy box check 08:43:57Z; omc config re-read 08:44:12Z
timeout 120 rtk proxy git push origin --delete rel-agent005                                  # 08:44:20Z, ls-remote empty ✓
# stability check 08:47:04Z
```
release.sh tail (`release-sh.log`; the bundle was built at 08:40:13Z):
```
→   building rel-agent005 @ fe1cdbf
→   node v22.21.1
→   BUILD_ID F2oHXhD6zjqi7IwuTmGfA
→ Scanning bundle for inlined credentials
→   clean
 + d74942c1...d05e6470 d05e64708ee04b39a8613e7158f2e519786e6981 -> release (forced update)
✓ Released rel-agent005 @ fe1cdbf → origin/release (d05e647)
```

**Forge deployment log** (`GET …/deployments/83536518/log`, redacted copy `forge-deploy-83536518.log`):
```
Fri Nov 20 08:43:05 UTC 2026
  already at d05e647
  27016MB free (minimum 1500MB)
  BUILD_ID F2oHXhD6zjqi7IwuTmGfA
  from rel-agent005 @ fe1cdbf — Merge pull request #219 from xavierau/develop
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
| 08:38:23 | main merge commit `fe1cdbfb` (PR #219) |
| 08:40:13 | bundle built on the Mac (node v22.21.1) |
| 08:42:36 | `release` force-pushed → `d05e6470`; Forge deployment 83536518 starts |
| 08:43:05 | deploy.sh starts; checkout already at `d05e647`; 27,016 MB free; `npm ci` skipped |
| 08:43:05–~08:43:20 | `supabase db push`: **Remote database is up to date** (no migration applied) |
| 08:43:23 | app daemon-746791 → **next-server 3671054** (`✓ Ready in 403ms`) |
| 08:43:26 | worker daemon-801730 → **pid 3671113** (`npm exec`); `Workers started: campaign, event-dispatch, receipt, email-send, integration-inbound, integration-outbound, agent-reply` |
| 08:43:28 | Forge deployment 83536518 finished |
| 08:43:57 | box `RELEASE.json`: source_ref `rel-agent005`, source_commit `fe1cdbfb…`, build_id `F2oHXhD6zjqi7IwuTmGfA` == `.next/BUILD_ID`; HEAD `d05e6470` (`box-after-deploy.log`) |

## Post-Deploy Verification (read-only: no tenant login, no settings write, no WhatsApp send, no DB write)
| check | result |
|---|---|
| release | `git ls-remote origin refs/heads/release` = `d05e64708ee04b39a8613e7158f2e519786e6981` (was `d74942c1`) |
| box provenance | `RELEASE.json` source_commit `fe1cdbfbb4749cad91e298c95a14336a904a1f6f` == main merge commit; build_id == `.next/BUILD_ID` == `F2oHXhD6zjqi7IwuTmGfA` |
| served build | `/login` **200**, embeds `F2oHXhD6zjqi7IwuTmGfA` once and the old `Dy3BMrmauUbUY9gIzFdVI` 0 times; `/api/health` **200** (08:43:58Z) |
| webhook | unsigned `POST /api/webhooks/whatsapp` with body `{}` → **401** (rejected before any processing; nothing sent or stored) |
| processes | app 3661017 → **3671054**, worker 3661081 → **3671113**, so both changed. At 08:47:04Z they were the same pids, up 3m40s / 3m37s (no restart) |
| worker | `Workers started: … agent-reply`; 0 lines after it at 08:47:04Z |
| app log, ≥3 min after restart | 8 lines after the `▲ Next.js` banner (`box-stability.log`): Local/Network, `✓ Ready`, `Running next.config.ts`, the known `"next start" does not work with "output: standalone"` warning, and **2 × `[Kapso] Error listing templates: WhatsApp configuration not found`** (known, not a regression). **0** `[AgentBooking]/[Booking] rate limiter unavailable` lines, **0** other error/warn/fail lines |
| omc config (read-only) | 08:44:12Z (`omc-config-postdeploy.log`): `booking_config` still has **no `bookingRules` key** (11 keys, md5 `540ec34c…` as before). `agent_config` rev **11**, 20 keys, md5 `cb96e1e4a9c5514f2f6e03de98bbad0b`, **identical** to the 08:35:43Z baseline |
| box after | MemAvailable 2,398 MB, swap 55 MB free, disk 26,989 MB free, load 0.20 |
| not run | the 訂座規則 field in Settings → Booking (needs a tenant login), and an agent reply asking for an out-of-hours time (needs a WhatsApp send). Both are the owner's live check |

## Rollback (ready, NOT executed; ETR ≈ 3 min)
Code-only: there is no migration to revert, and no data was written. This goes back to the BOOK-008 release
(`d74942c1` = `main@1f2b9eb4`, BUILD_ID `Dy3BMrmauUbUY9gIzFdVI`). It is a force-push to `release`, so it **needs the
owner's OK**, relayed by main:
```
# from any worktree of this repo (local refs are shared)
rtk proxy git push --force origin release-backup-d74942c:refs/heads/release
git ls-remote origin refs/heads/release      # must read d74942c119e55b17bfec0961c8a319bd6e30faad
# Forge redeploys: RELEASE.json source_commit 1f2b9eb4, BUILD_ID Dy3BMrmauUbUY9gIzFdVI, both pids change, /api/health 200.
```
If the local ref is gone, force-push by SHA `d74942c119e55b17bfec0961c8a319bd6e30faad`. After a rollback the agent goes
back to one rule block (the pre-AGENT-005 prompt), and the 訂座規則 field disappears from Settings → Booking. A
`bookingRules` value saved in the meantime is ignored on read: at `1f2b9eb4`, `resolveBookingConfig` rebuilds the
config from its known keys only. A Settings → Booking save under the rolled-back build may drop the key (unconfirmed
— looked in: `src/domain/value-objects/booking-config.ts` at `1f2b9eb4`; whether the old write path writes the
resolved object or merges into the stored JSONB was not traced). Before rolling back once the owner has filled
訂座規則, read omc's value first so it can be re-entered.

## Cleanup
| item | state |
|---|---|
| remote `rel-agent005` | deleted at 08:44:20Z; `ls-remote origin refs/heads/rel-agent005` is empty |
| local branch `rel-agent005` | deleted (`git branch -D`) |
| local ref `release-backup-d74942c` | kept as the rollback handle (not pushed) |
| `origin/release` `d74942c1` → `d05e6470` | replaced (force-push by `release.sh`, by design) |
| box | nothing created; SSH reads only, no temp files |
| worktree `--release-agent005` | removed after the docs PR was pushed (see handoff) |
| worktree `--agent-005` | untouched |
