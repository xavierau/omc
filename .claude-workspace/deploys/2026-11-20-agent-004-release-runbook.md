---
id: deploys/2026-11-20-agent-004-release-runbook
type: deploy
author: dev
created: 2026-11-20
status: executed
supersedes: null
superseded_by: null
related: [kanban:AGENT-004, github:204, github:205, artifacts/2026-11-20-rel-agent004-handoff, artifacts/2026-11-20-agent-004-handoff, deploys/2026-11-20-camp-016-release-runbook, deploys/2026-11-19-agent-003-release-runbook]
---

# Deploy: AGENT-004 classifier skip: `main` @ `4af4caaf` to production

**Outcome: DEPLOYED 2026-11-20 02:39Z (10:39 HKT). No migration. Every read-only check passes.** Prod serves
`main@4af4caaf`, release **`e5ddd701`**, BUILD_ID **`zzJgH7D65-G0P4rKNa3uS`**. App next-server pid **3531138**,
worker pid **3531178** (`npm exec`). The owner's live omc check is still to do.

Stage: POC (the repo does not import `stages/mature.md`). Hosting: the existing Forge box; the `fly-deploy` and
Cloudflare rules do not apply. Go: Xavier, 2026-11-20 ("merge and release it"), relayed by main. Repo `xavierau/omc`
is **public**: no tenant id, user id, email, phone number, message text or secret appears below or in the evidence
(`built_by` and the seeded admin email are redacted). All times are UTC.

## Scope
- `main` before: **`188bf93a`** (CAMP-016 release). `main` now: **`4af4caaf`** = merge of release PR **#205**
  (develop `94e868ed` → main), which brings:
  - `94e868ed` AGENT-004 (PR #204 squash): when agent mode is auto and the worker's effective tool set has a booking
    tool, unmatched free text skips the BOOK-001 booking-intent classifier and goes to the agent queue. Off, shadow,
    no effective booking tool, or a config read failure keep the old order. The BOOK keyword route is unchanged.
    Files: `src/app/api/webhooks/whatsapp/{handlers,agent-handler}.ts`,
    `src/application/agent/{agent-owns-booking-text,agent-tools}.ts`, two test files, the debugging journal.
  - `15fb61ef` CAMP-016 release docs (#203, workspace records only).
- Delta `188bf93a..4af4caaf`: nothing under `supabase/`; no change to `package.json`, `package-lock.json`,
  `scripts/`, `deploy.sh` or `.env.example`. So no migration, no `npm ci` on the box, no env var, no cron route.
  (The only path matching "migration" is the CAMP-016 evidence file `migration-086-checks.log`.)
- Target: `https://app.ohmyclient.io`, Forge server 1149990 / site 3123752, checkout
  `/home/forge/app.ohmyclient.io` on `release`.
- Previous prod: `main@188bf93a`, release **`b40e2e29`**, BUILD_ID `nUUD8IZ3cKKd62nx1V0ws`, app pid 3321221,
  worker pid 3321288.
- Executed from a fresh detached worktree `/Users/xavierau/Code/js/whatsapp-crm--release-agent004` at `94e868ed`,
  with `.env.local` and `.env.production.local` copied from the primary checkout (`cmp` identical, gitignored, never
  committed). The primary checkout and every other worktree (incl. `--agent-004`) were not touched; nothing stashed.

## Pre-Flight
- [x] **Range** (02:24Z): `origin/develop` = `94e868ed`; `origin/main..origin/develop` = `15fb61ef`, `94e868ed` only.
- [x] **Gate** on `94e868ed` under the heavy lock, 02:25:16–02:27:02Z. Exit codes read from files
      (`artifacts/evidence/2026-11-20-agent-004-release/ac-gate-*`):
  - `npm ci` exit 0 (fresh tree, no `node_modules`).
  - `tsc --noEmit` exit 0 (empty log).
  - `vitest run` exit 0: **661 files passed / 14 skipped, 7,541 tests passed, 127 skipped, 2 todo**.
  - The released tree (`4af4caaf`) has the same tree as `94e868ed` (`6f4dc031…`).
- [x] **Box** (02:28:41Z, `box-preflight.log`): HEAD `b40e2e29`, `.next/BUILD_ID` `nUUD8IZ3cKKd62nx1V0ws`,
      RELEASE.json source_commit `188bf93a`; app 3321221 and worker 3321288 up 9h28m. Disk 26,939 MB free (deploy.sh
      floor 1,500 MB), MemAvailable 2,381 MB, swap 9 MB free (idle, as in the precedents), load 0.40. The build is
      off-box and `npm ci` is skipped, so the box only restarts the daemons.
- [x] **No DB backup taken**: no migration and no data write in this release (the CAMP-016 backups and managed
      backups stand).
- [x] **Restore point.** `origin/release` (`b40e2e29`) fetched as the local ref **`release-backup-b40e2e2`** (not
      pushed).

## Runbook (as executed)
```
cd /Users/xavierau/Code/js/whatsapp-crm
rtk proxy git fetch origin --prune
rtk proxy git worktree add --detach ../whatsapp-crm--release-agent004 94e868ed
cp .env.local .env.production.local ../whatsapp-crm--release-agent004/                    # cmp identical
rtk proxy git fetch origin refs/heads/release:refs/heads/release-backup-b40e2e2            # b40e2e29
cd ../whatsapp-crm--release-agent004
resource-lock.py heavy -- bash -c 'npm ci; npx tsc --noEmit; npx vitest run'               # all exit 0
# box pre-flight: Forge site command 14469223 (read-only)
rtk proxy git merge-tree --write-tree origin/main origin/develop                          # exit 0, tree 6f4dc031 == develop
gh pr create --base main --head develop                                                   # #205, MERGEABLE/CLEAN, CodeRabbit pass
gh pr merge 205 --merge --match-head-commit 94e868ed…                                     # 02:31:57Z → 4af4caaf
rtk proxy git checkout -B rel-agent004 4af4caaf
timeout 120 rtk proxy git push origin rel-agent004:refs/heads/rel-agent004                 # ls-remote 4af4caaf ✓
SOURCE_REF=rel-agent004 resource-lock.py heavy -- bash scripts/release.sh                  # exit 0, 02:32:27–02:38:51Z
git ls-remote origin refs/heads/release                                                     # e5ddd701 ✓ (was b40e2e29)
# Forge auto-deploy 83519795: deploy.sh → db push (nothing pending) → seed → restart app + worker
timeout 120 rtk proxy git push origin --delete rel-agent004                                 # ls-remote empty ✓
```
The `release.sh` wait includes time queued on the heavy lock; the bundle was built at 02:34:15Z.
release.sh tail (`release-sh.log`):
```
→   building rel-agent004 @ 4af4caa
→   node v22.21.1
→   BUILD_ID zzJgH7D65-G0P4rKNa3uS
→ Scanning bundle for inlined credentials
→   clean
 + b40e2e29...e5ddd701 e5ddd701443406910f20eab8ae4f12a63e09f37f -> release (forced update)
✓ Released rel-agent004 @ 4af4caa → origin/release (e5ddd70)
```

**Forge deployment log** (`GET …/deployments/83519795/log`, redacted copy `forge-deploy-83519795.log`):
```
Fri Nov 20 02:39:16 UTC 2026
  already at e5ddd70
  26937MB free (minimum 1500MB)
  BUILD_ID zzJgH7D65-G0P4rKNa3uS
  from rel-agent004 @ 4af4caa — Merge pull request #205 from xavierau/develop
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
| 02:31:57 | main merge commit `4af4caaf` (PR #205) |
| 02:34:15 | bundle built on the Mac (node v22.21.1) |
| 02:38:50 | `release` force-pushed → `e5ddd701`; Forge deployment 83519795 starts |
| 02:39:16 | deploy.sh starts; checkout already at `e5ddd70`; 26,937 MB free; `npm ci` skipped |
| ~02:39:30 | `supabase db push`: **Remote database is up to date** (no migration applied) |
| ~02:39:34 | app daemon-746791 → **next-server 3531138** (`✓ Ready in 470ms`) |
| ~02:39:38 | worker daemon-801730 → **pid 3531178** (`npm exec`); `Workers started: campaign, event-dispatch, receipt, email-send, integration-inbound, integration-outbound, agent-reply` |
| 02:39:39 | Forge deployment 83519795 finished |
| 02:40:25 | box `RELEASE.json`: source_ref `rel-agent004`, source_commit `4af4caaf…`, build_id `zzJgH7D65-G0P4rKNa3uS` == `.next/BUILD_ID`; HEAD `e5ddd701` (`box-after-deploy.log`) |

## Post-Deploy Verification (read-only: no tenant login, no WhatsApp send, no DB write; ALL PASS)
| check | result |
|---|---|
| release | `git ls-remote origin refs/heads/release` = `e5ddd701443406910f20eab8ae4f12a63e09f37f` (was `b40e2e29`) |
| box provenance | `RELEASE.json` source_commit `4af4caaf6d43b2af66fda67c0fdd789f36177b9c` == main merge commit; build_id == `.next/BUILD_ID` |
| served build | `/login` **200**, embeds `zzJgH7D65-G0P4rKNa3uS` once and the old BUILD_ID 0 times; `/api/health` **200** (`ac-smoke.log`, 02:40:04Z) |
| webhook | unsigned empty `POST /api/webhooks/whatsapp` → **401** (rejected before any processing; nothing sent or stored) |
| processes | app 3321221 → **3531138**, worker 3321288 → **3531178**: both changed; at 02:44:12Z the same pids, up 4m38s / 4m34s (no restart) |
| worker | `Workers started: … agent-reply` |
| logs, ≥3 min after restart | **0 new error lines** (`box-stability.log`, 02:44:12Z). App: 5 lines after the `▲ Next.js` banner: Local/Network, `✓ Ready in 470ms`, `Running next.config.ts`, and the known `"next start" does not work with "output: standalone"` warning. Worker: 0 lines after `Workers started` |
| box after | MemAvailable 2,371 MB, swap 93 MB free, disk 26,936 MB free, load 0.25 |
| not run | the AGENT-004 behaviour itself (needs a real diner thread with the omc agent): the owner's live omc check |

## Rollback (ready, NOT executed; ETR ≈ 3 min)
Code-only: no migration to revert. Back to the CAMP-016 release (`b40e2e29` = `main@188bf93a`, BUILD_ID
`nUUD8IZ3cKKd62nx1V0ws`). This is a force-push to `release` and **needs Xavier's OK**:
```
# from any worktree of this repo (local refs are shared)
rtk proxy git push --force origin release-backup-b40e2e2:refs/heads/release
git ls-remote origin refs/heads/release      # must read b40e2e29dc0a9ea0531616e7a576c82b24e9ad2b
# Forge redeploys: RELEASE.json source_commit 188bf93a, BUILD_ID nUUD8IZ3cKKd62nx1V0ws, both pids change, /api/health 200.
```
If the local ref is gone, force-push by SHA `b40e2e29dc0a9ea0531616e7a576c82b24e9ad2b`. After a rollback, auto-agent
tenants get the BOOK-001 new-booking form again for replies to the agent's booking questions (the pre-AGENT-004
behaviour); no data is affected.

## Cleanup
| item | state |
|---|---|
| remote `rel-agent004` | deleted after the deploy; `ls-remote origin refs/heads/rel-agent004` empty |
| local branch `rel-agent004` | deleted (`git branch -D`) |
| local ref `release-backup-b40e2e2` | kept as the rollback handle (not pushed) |
| `origin/release` `b40e2e29` → `e5ddd701` | replaced (force-push by `release.sh`, by design) |
| box | nothing created (read-only site commands; temp file in `/tmp` removed by the same command) |
| worktree `--release-agent004` | removed after the docs PR was pushed (see handoff) |
| worktree `--agent-004` | untouched (per brief) |
