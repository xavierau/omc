---
id: deploys/2026-11-05-camp-014-release-runbook
type: deploy
author: dev
created: 2026-11-05
status: executed
supersedes: null
superseded_by: null
related: [kanban:CAMP-014, kanban:CAMP-015, github:176, github:177, investigations/2026-11-05-bicho-campaign-131042-wrong-reason, plans/2026-11-05-camp-014-failed-campaign-remedy, reviews/2026-11-05-camp-014-re-review-3, deploys/2026-11-03-camp-expiry-waq-detail-release-runbook]
---

# Deploy: CAMP-014: `main` @ `84f4629` to production

**Outcome: DEPLOYED 2026-11-05 04:56Z. All read-only checks PASS. No migrations, no env changes, no prod data written,
no Meta or customer message sent.** Prod serves `main@84f46297`, release `b0b4ef0`, BUILD_ID `THI1PO_omqiN4JkzDp8Ly`,
both daemons restarted (app pid 78688, worker pid 78805), `/api/health` 200. The three failed campaigns keep their
status and stored reason; rewording or re-running them is the owner's separate decision.

Stage: POC (repo does not import `stages/mature.md`). Hosting: existing Forge box; `fly-deploy` and Cloudflare rules do
not apply.

## Scope
- PR **#176** (`fix/camp-014-failed-campaign-remedy` → develop, squash **`329cabd1`**, 04:37:16Z): failed-campaign reason
  from Meta's own detail, guarded re-run route and action on failed cards, QR failure visibility. Tree at `329cabd1`
  equals the reviewed head `162af113` (`git diff` empty).
- Release PR **#177** (develop `329cabd1` → main, merge commit **`84f46297768cc6db9d62f85da46ba130d2a13e0c`**, 04:39:27Z,
  CLEAN, no conflicts).
- Parity: `git diff origin/main origin/develop -- src supabase scripts package.json package-lock.json` **empty**.
  `git diff cca6a90b origin/main -- .claude/kanban.json .claude-workspace/INDEX.md` **empty**. No conflict markers.
- `git diff 53e6e3ff..84f46297 -- supabase/migrations` **empty**. `package.json` / lockfile unchanged. New `process.env`
  reads in `src`: test files only.
- Target: `https://app.ohmyclient.io`, Forge server 1149990 / site 3123752, `forge@34.158.58.133`, checkout
  `/home/forge/app.ohmyclient.io` on `release`.
- Previous prod: `main@53e6e3ff`, release **`774f09a`**, BUILD_ID `KOJQFrs1uv8DiVp8UVGlJ`, pids 3323292 / 3323364.
- Executed from worktree `/Users/xavierau/Code/js/whatsapp-crm--release-camp014` (detached from `origin/main`, fresh
  `npm ci`, `.env.local` + `.env.production.local` copied from the primary, both gitignored and never committed).
  Primary checkout and other worktrees untouched. Go: owner approval of 2026-11-05, relayed by the main thread.

## Pre-Flight
- [x] **Gate on develop tip `329cabd1`** (heavy lock, exit codes read from a file, no pipes): `vitest run` **exit 0**,
      569 files passed / 7 skipped, 6,096 tests passed, 46 skipped, 2 todo, 0 failed (28.3 s). `tsc --noEmit` **exit 0**.
      No flaky WAQ webhook failures. GitHub checks: CodeRabbit SUCCESS on #176.
- [x] **Box (04:37:51Z, repeated 04:39:37Z)**: disk **28,221 MB free** (52 %, floor 2 GB); RAM available 2,086 MB, swap
      987/1,023 MB (standing); RELEASE.json `53e6e3ff`, HEAD `774f09af`, BUILD_ID `KOJQFrs1uv8DiVp8UVGlJ`; daemons RUNNING
      3323292 / 3323364; load 0.35.
- [x] **Public baseline**: `/api/health` 200. Unauthenticated `POST
      /api/dashboard/campaigns/00000000-0000-0000-0000-000000000000/rerun` **404** (route absent).
- [x] **DB baseline (GET only, PostgREST on the box, key from the box `.env`, never printed)**: 38 campaigns; 3 `failed`:
      `1a476235-…` "Mid autumn 2026_test" (reason md5 `71b0b1cb…`), `6fff0fa9-…` "Nov promo_batch1" (`71b0b1cb…`),
      `e2023d99-…` "mid autumn batch 1" (`1d5d91e7…`). All sent counters 0/0.
- [x] **Restore point**: `origin/release` fetched as local ref **`release-backup-774f09a`** (not pushed).

## Runbook (as executed, UTC)
```
cd /Users/xavierau/Code/js/whatsapp-crm
rtk proxy git worktree add --detach ../whatsapp-crm--release-camp014 origin/main    # cca6a90b
cd ../whatsapp-crm--release-camp014
gh pr merge 176 --squash                                                            # 04:37:16Z → 329cabd1
rtk proxy git checkout --detach origin/develop
cp <primary>/.env.local <primary>/.env.production.local .
resource-lock.py heavy -- sh -c 'npm ci; vitest run; tsc --noEmit'                  # gate, see Pre-Flight
gh pr create --base main --head develop --title "release: CAMP-014 …"               # #177, MERGEABLE CLEAN
gh pr merge 177 --merge                                                             # 04:39:27Z → 84f46297 (ls-remote ✓)
rtk proxy git checkout -B release-camp014 origin/main
rtk proxy git fetch origin refs/heads/release:refs/heads/release-backup-774f09a
rtk proxy git push origin release-camp014:refs/heads/release-camp014                # ls-remote 84f46297 ✓
SOURCE_REF=release-camp014 resource-lock.py heavy -- bash scripts/release.sh        # queued 04:39:40Z behind another
                                                                                    # repo's Playwright run; ran
                                                                                    # 04:51:32Z → 04:56:00Z, exit 0
git ls-remote origin refs/heads/release                                             # b0b4ef04 ✓ (was 774f09af)
rtk proxy git push origin --delete release-camp014                                  # ls-remote empty ✓
```
release.sh tail:
```
→   building release-camp014 @ 84f4629    node v22.21.1
✓ Compiled successfully in 11.4s
→   BUILD_ID THI1PO_omqiN4JkzDp8Ly
→ Scanning bundle for inlined credentials →   clean
 + 774f09af...b0b4ef04 b0b4ef045f8ae0bb1a2f3ed12355c05bc04ce990 -> release (forced update)
✓ Released release-camp014 @ 84f4629 → origin/release (b0b4ef0)
release.sh exit=0
```
`RELEASE.json.source_ref` reads `release-camp014` (the temp branch); `source_commit` is the real main tip.

## Deploy facts (Forge auto-deploy of `release`)
| time (UTC) | event |
|---|---|
| 04:52:53 | bundle built (`RELEASE.json.built_at`) |
| 04:55:59 | Forge deployment **82154230** started (commit `b0b4ef04`) |
| 04:56:35 | box checkout synced: RELEASE.json `84f46297` |
| ~04:56:45 | app daemon 746791 → **pid 78688**, worker 801730 → **pid 78805** |
| 04:56:49 | Forge deployment 82154230 `finished` |
| 04:57:31–04:59:28 | verification below |

## Post-Deploy Verification (read-only; ALL PASS unless noted)
| check | result |
|---|---|
| provenance | RELEASE.json `source_commit 84f46297768cc6db9d62f85da46ba130d2a13e0c` == main tip, `build_id THI1PO_omqiN4JkzDp8Ly` == `.next/BUILD_ID`; HEAD `b0b4ef04` on `release`; only dirt ` M supabase/.temp/cli-latest` (pre-existing) |
| daemons | RUNNING pids 78688 / 78805 (were 3323292 / 3323364); same pids at 04:59:25Z, uptime 2:41 / 2:37, so no crash loop |
| public | `/api/health` **200** (also at 04:59:28Z), `/login` 200, `/` 307 |
| served build | `/login` embeds `THI1PO_omqiN4JkzDp8Ly` 1×, old `KOJQFrs1uv8DiVp8UVGlJ` 0×; referenced chunk `/_next/static/chunks/3yfl9fgvivx3-.js` **200** (#56 failure mode absent) |
| rerun route, unauthenticated | `POST …/00000000-0000-0000-0000-000000000000/rerun` → **401** `{"error":"Unauthorized"}` (was 404): route live and auth-gated, no data read or written. `.next/server/app/api/dashboard/campaigns/[id]/rerun/route.js` present |
| client bundle markers (`.next/static`) | `campaign-rerun-button` 1 file, `campaign-rerun-confirm` 1, `campaign-rerun-qr-only-warning` 1 |
| zh-HK strings (`.next/server`) | `重新發送推廣` 111 files, `立即重新發送` 111 files |
| en strings | `Re-run campaign`, `Re-run now` in `src/messages/en.json` on the box, **0** files in `.next/static` and `.next/server`. See Notes: this build compiles zh-HK only |
| failure wording (`.next/server`) | `Meta has restricted payments` 5 files. The literal `payment has been restricted` is Meta's wording, matched at runtime on `restricted`; it exists only in test fixtures, so 0 files in the build, as expected |
| logs (scrubbed, ≥2 min after restart) | app: `✓ Ready in 510ms`, plus the pre-existing `"next start" does not work with "output: standalone"` warning. Worker: `Workers shut down cleanly` then `Workers started: campaign, event-dispatch, receipt, email-send, integration-inbound, integration-outbound`. 0 fatal, uncaught, unhandled or missing-module lines in either |
| box and sharing sites | load 0.54 / 0.52 / 0.46 (0.35 before), RAM available 2,434 MB, swap 800/1,023 MB, disk 28,215 MB free; all 4 supervisor programs RUNNING. Other sites' URLs were not probed; the build ran off-box |
| DB (GET only, 04:59:28Z) | output **byte-identical** to the baseline: 38 campaigns, the same 3 `failed` rows, same `last_enqueued_at`, counters and reason hashes |
| authenticated UI smoke | **NOT RUN** by design: no tenant login, no re-run, no send |

## Rollback (ready, NOT executed; ETR ≈ 1–2 min; no DB change to undo)
Redeploy the previous bundle, release commit `774f09a` (= `main@53e6e3ff`, BUILD_ID `KOJQFrs1uv8DiVp8UVGlJ`):
```
cd /Users/xavierau/Code/js/whatsapp-crm       # local refs are shared by every worktree of this repo
rtk proxy git push --force origin release-backup-774f09a:refs/heads/release
git ls-remote origin refs/heads/release       # must read 774f09af8949e637b5c5544695a46d1310011d15
# Forge redeploys: RELEASE.json source_commit 53e6e3ff, both pids change, /api/health 200,
# POST …/00000000-0000-0000-0000-000000000000/rerun back to 404. No migrations to revert.
```
The `release` commit is an orphan and GitHub may garbage-collect it, so the local ref `release-backup-774f09a` is the
handle; a force-push by SHA `774f09af8949e637b5c5544695a46d1310011d15` works from any clone that still has it. If neither
exists, rebuild: `SOURCE_REF=<branch at 53e6e3ff> bash scripts/release.sh`. Surface to the owner before rolling back
unless service is down.

## Cleanup
| item | state |
|---|---|
| remote `release-camp014` @ 84f46297 | **deleted** (`ls-remote` empty) |
| worktrees `--release-camp014`, `--camp-014` | removed after this runbook was pushed |
| local ref `release-backup-774f09a` | kept as the rollback handle |
| `origin/release` `774f09a` → `b0b4ef0` | replaced (force-push by design) |
| prod data / env / DB | untouched |

## Notes
- **en strings are not in the build, by design of the current config.** `src/i18n/request.ts` imports
  `../messages/${NEXT_PUBLIC_DEFAULT_LOCALE}.json`; the variable is inlined at build, so only `zh-HK.json` is compiled.
  Control: 1 of 15 randomly sampled pre-existing en strings appears in `.next/server`. Prod serves zh-HK, and the en
  strings are shipped only as source on the box.
- **Failure reasons are English on the zh-HK UI**: known, tracked in CAMP-015.
- The stored reasons on Bicho ("Nov promo_batch1") and 長盈行 keep the old wording; only new failures get the new text.
- The primary checkout (`main` @ `fdbe34eb`, dirty) is behind `origin/main`. It holds the four CAMP-014 review files as
  untracked copies, which are now tracked on main, so a pull there will refuse until those untracked copies are moved.
- The remote branch `fix/camp-014-failed-campaign-remedy` was left in place.
