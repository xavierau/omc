---
id: deploys/2026-11-03-camp-expiry-waq-detail-release-runbook
type: deploy
author: dev
created: 2026-11-03
status: executed
supersedes: null
superseded_by: null
related: [kanban:CAMP-EXPIRY-001, kanban:WAQ-011, github:173, github:174, github:175, deploys/2026-10-07-mem-001-004-release-runbook, deploys/2026-09-10-int-001-release-runbook]
---

# Deploy: CAMP-EXPIRY-001 + WAQ-011 detail: `main` @ `53e6e3f` to production

**Outcome: DEPLOYED 2026-11-03 08:06Z. All read-only checks PASS. No migrations, no env changes, no prod
data read or written by this run.** Prod serves `main@53e6e3ff`, release `774f09a`, BUILD_ID
`KOJQFrs1uv8DiVp8UVGlJ`, both daemons restarted (app pid 3323292, worker pid 3323364), `/api/health` 200.
The pending template review (`8f97403c-…`) was not opened, approved or rejected; the owner reviews it.

## Scope
- PR **#173** (`fix/campaign-expiry-no-discount-alert` → develop, squash **`1dc09894`**, 07:53:47Z): campaign
  form coupon notices from a shared `couponRequirement` domain rule; a welcome campaign requires a discount.
- PR **#174** (`feature/admin-template-review-detail` → develop, squash **`99c1f6b3`**, 07:57:26Z): admin
  template review detail panel and a new read-only platform-admin `GET /api/admin/template-reviews/[id]`
  (before this release the `[id]` route had POST only, so GET answered 405).
  Before merging, `origin/develop` (with #173) was merged into the #174 branch (`90637b53`). Only conflict:
  `.claude-workspace/ui-map/testid-registry.md` (both sides appended rows; kept both). `src/messages/en.json` /
  `zh-HK.json` auto-merged; both parse, no duplicate keys. #174's 16 touched test files (212 tests) and whole-project
  `tsc` green after the merge.
- Release PR **#175** (develop `99c1f6b3` → main, merge commit **`53e6e3ff96c90edd01ae830623f786155d97a2b1`**,
  07:59:04Z, CLEAN). Superset proof: develop changed no kanban/INDEX lines since merge base `07316f36`; the merged
  tree equals main for `.claude/kanban.json` + `INDEX.md` and equals develop for `src/ supabase/ scripts/ package*.json`
  (all three `git diff --stat` empty). Merged tree = pre-computed `git merge-tree` `d6f85dd`.
- `git diff f2566d5b..53e6e3ff -- supabase/migrations` **empty**. Lockfile unchanged (deploy.sh skips `npm ci`).
  New `process.env` reads: only `NEXT_PUBLIC_SUPABASE_URL` (already set).
- Target: `https://app.ohmyclient.io`, Forge server 1149990 / site 3123752, `forge@34.158.58.133`, checkout
  `/home/forge/app.ohmyclient.io` on `release`.
- Previous prod: `main@d73b7e2a`, release **`0071fa3`**, BUILD_ID `AkWQ9N80t9yjaXRQRWYWu`, pids 2283793 / 2283794
  (10 days uptime).
- Executed from worktree `/Users/xavierau/Code/js/whatsapp-crm--release-1103` (created with `git worktree add
  --detach` from the primary, fresh `npm ci`, `.env.local` + `.env.production.local` copied from the primary, both
  gitignored, never committed). Primary checkout and the `--camp-expiry-001` / `--waq-011-detail` worktrees untouched
  (the #174 branch was updated from a detached HEAD in the release worktree). Go: owner approval of 2026-11-03,
  relayed by the main thread.

## Pre-Flight
- [x] **Gate on develop tip `99c1f6b3`** (heavy lock, once): `vitest run` → **557 files passed / 7 skipped;
      5,900 tests passed, 46 skipped, 2 todo, 0 failed** (25.4 s). No flaky WAQ webhook failures this run.
      `tsc --noEmit` **exit 0**. GitHub checks: none beyond mergeability.
- [x] **Box (07:59:29Z)**: disk **28,730 MB free** (51 %, floor 2 GB); RAM available 1,193 MB, swap 919/1,023 MB
      (standing); RELEASE.json `d73b7e2a`, HEAD `0071fa3`, BUILD_ID `AkWQ9N80t9yjaXRQRWYWu`; daemons RUNNING
      2283793 / 2283794.
- [x] **Public baseline**: `/api/health` 200; `GET /api/admin/template-reviews/8f97403c-2ca8-4730-b811-bd44774d53fa` **405**.
- [x] **Restore point**: `origin/release` fetched as local ref **`release-backup-0071fa3`** in the release worktree
      (not pushed).

## Runbook (as executed, UTC)
```
cd /Users/xavierau/Code/js/whatsapp-crm
git worktree add --detach ../whatsapp-crm--release-1103 origin/main            # f2566d5b
cd ../whatsapp-crm--release-1103
gh pr merge 173 --squash                                                        # 07:53:47Z → 1dc09894
git checkout --detach origin/feature/admin-template-review-detail && git merge --no-ff origin/develop
#   resolve testid-registry.md (keep both), commit 90637b53
resource-lock.py heavy -- npm ci;  cp <primary>/.env.local <primary>/.env.production.local .
resource-lock.py heavy -- vitest run <16 touched test files> && tsc --noEmit     # 212 passed, tsc clean
rtk proxy git push origin HEAD:refs/heads/feature/admin-template-review-detail   # ls-remote 90637b53 ✓
gh pr merge 174 --squash                                                        # 07:57:26Z → 99c1f6b3
git checkout --detach origin/develop
resource-lock.py heavy -- sh -c 'vitest run; tsc --noEmit'                      # gate, see Pre-Flight
gh pr create --base main --head develop --title "release: CAMP-EXPIRY-001 …"    # #175
gh pr merge 175 --merge                                                         # 07:59:04Z → 53e6e3ff (ls-remote ✓)
git checkout -B release-1103 origin/main
git fetch origin refs/heads/release:refs/heads/release-backup-0071fa3
rtk proxy git push origin release-1103:refs/heads/release-1103                  # ls-remote 53e6e3ff ✓
SOURCE_REF=release-1103 resource-lock.py heavy -- bash scripts/release.sh       # 07:59:31Z → 08:05:01Z, exit 0
git ls-remote --heads origin release                                            # 774f09af ✓ (was 0071fa31)
rtk proxy git push origin --delete release-1103                                 # 08:06:28Z, ls-remote empty
```
release.sh tail:
```
→   building release-1103 @ 53e6e3f        node v22.21.1
✓ Compiled successfully in 21.3s
✓ Generating static pages using 7 workers (84/84) in 592ms
→   BUILD_ID KOJQFrs1uv8DiVp8UVGlJ
→ Scanning bundle for inlined credentials →   clean
 + 0071fa31...774f09af 774f09af8949e637b5c5544695a46d1310011d15 -> release (forced update)
✓ Released release-1103 @ 53e6e3f → origin/release (774f09a)
release.sh exit=0
```
`RELEASE.json.source_ref` reads `release-1103` (the temp branch); `source_commit` is the real main tip.

## Deploy facts (Forge auto-deploy of `release`)
| time (UTC) | event |
|---|---|
| 08:03:24 | bundle built (`RELEASE.json.built_at`) |
| ~08:05:00 | `release` force-pushed → `774f09a` |
| ≤08:05:37 | box checkout synced: RELEASE.json `53e6e3ff` |
| ~08:05:46 | app daemon 746791 → **pid 3323292**, worker 801730 → **pid 3323364** (uptime 0:00:16 / 0:00:11 at 08:06:02) |
| 08:06:09–15 | verification below |

## Post-Deploy Verification (read-only; ALL PASS)
| check | result |
|---|---|
| provenance | RELEASE.json `source_commit 53e6e3ff96c90edd01ae830623f786155d97a2b1` == main tip, `build_id KOJQFrs1uv8DiVp8UVGlJ` == `.next/BUILD_ID`; HEAD `774f09af` on `release`; only dirt ` M supabase/.temp/cli-latest` (pre-existing) |
| served build | `/login` embeds `KOJQFrs1uv8DiVp8UVGlJ` 1×, old `AkWQ9N80t9yjaXRQRWYWu` 0×; referenced chunk `/_next/static/chunks/3yfl9fgvivx3-.js` **200** (#56 failure mode absent) |
| bundle markers (`.next/static`) | `campaign-coupon-blocked-alert` 1 file, `campaign-coupon-welcome-required-alert` 1, `template-review-submitted-content` 1, `template-review-preview` 1; `.next/server/app/api/admin/template-reviews/[id]/route.js` present |
| daemons | both RUNNING, pids 3323292 / 3323364 (were 2283793 / 2283794) |
| logs | worker: `Workers started: campaign, event-dispatch, receipt, email-send, integration-inbound, integration-outbound`, only `errored: 0` summaries after; app: `✓ Ready in 626ms`. The `"next start" does not work with "output: standalone"` warning is pre-existing (45 of 91 starts in the log) |
| public | `/api/health` **200** `{"status":"ok"}`, `/login` 200, `/` 307 |
| admin detail smoke (unauthenticated) | `GET /api/admin/template-reviews/8f97403c-2ca8-4730-b811-bd44774d53fa` → **401** `{"error":"Unauthorized"}` (was 405 before: route live and auth-gated, no 500, no data) |
| authenticated UI smoke | **NOT RUN** by design: no admin login, no approve/reject; the owner reviews Bicho's pending template |
| box | disk 28,748 MB free (51 %); RAM available 2,372 MB |

## Rollback (ready, NOT executed; ETR ≈ 1–2 min; no DB change to undo)
Redeploy the previous bundle, release commit `0071fa3` (= `main@d73b7e2a`, BUILD_ID `AkWQ9N80t9yjaXRQRWYWu`):
```
cd /Users/xavierau/Code/js/whatsapp-crm--release-1103
rtk proxy git push --force origin release-backup-0071fa3:refs/heads/release    # or 0071fa3114b1bbb4988f6eb92a62db8dd3de9de9:refs/heads/release
git ls-remote --heads origin release                                           # must read 0071fa31…
# Forge redeploys: RELEASE.json source_commit d73b7e2a, both pids change, /api/health 200,
# GET /api/admin/template-reviews/<id> back to 405. No migrations to revert.
```
If the release worktree is gone, the SHA `0071fa3114b1bbb4988f6eb92a62db8dd3de9de9` is still reachable on GitHub
(force-push by SHA). Surface to the owner before rolling back, never silently.

## Cleanup
| item | state |
|---|---|
| remote `release-1103` @ 53e6e3ff | **deleted** 08:06:28Z (`ls-remote` empty) |
| worktree `/Users/xavierau/Code/js/whatsapp-crm--release-1103` + local ref `release-backup-0071fa3` | kept as the rollback handle |
| `origin/release` `0071fa3` → `774f09a` | replaced (force-push by design) |
| prod data / env / DB | untouched |

## Notes
- The primary checkout `/Users/xavierau/Code/js/whatsapp-crm` (on `main` @ `fdbe34eb`, dirty) is behind `origin/main`.
- The local `feature/admin-template-review-detail` branch in the `--waq-011-detail` worktree is behind its remote
  (remote has merge `90637b53`); the PR is merged, so nothing to do there.
- Kanban not edited by this run (main thread owns it).
