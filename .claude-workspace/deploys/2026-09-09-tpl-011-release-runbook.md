---
id: deploys/2026-09-09-tpl-011-release-runbook
type: deploy
author: devops-engineer
created: 2026-09-09
status: active
supersedes: null
superseded_by: null
related: [kanban:TPL-011, github:153, github:154, plans/2026-09-09-tpl-011-video-template-header, deploys/2026-09-09-tpl-011-video-upload-body-limit, deploys/2026-08-28-wonb-018-019-release-runbook, tests/2026-09-09-tpl-011-video-header-ui]
---

# Deploy: TPL-011 VIDEO template header — `origin/main` @ `c67fd2c` to production

**Outcome: DEPLOYED 2026-09-09 14:39Z.** Prod serves `c67fd2c`, BUILD_ID `E55lhdggn6bYvU_D4H__k`, both
daemons restarted, `/api/health` 200. I-2 **DEFERRED — user verifies manually with own account** (user
decision relayed by team-lead; no prod users, tenants or templates were created).

## Scope
- Ships: PR #153 (`feature/tpl-011` → develop, squash `71d625e`) via PR #154 (develop → main, merge
  **`c67fd2c`**): `video/mp4` + `video/3gpp` accepted on `POST /api/dashboard/upload` for the
  `wa-template-media` bucket only (16 MB video / 5 MB image per-type cap in `upload-policy.ts`), `Video`
  header option + `VideoUploader` in the WA template form, VIDEO component round-trip, Kapso
  `template-media-upload.ts` `MIME_BY_EXT` gains `mp4`/`3gp`, media-neutral error strings, i18n
  `waTemplates.videoHeaderHint` (en + zh-HK). 45 files, 2,241 insertions.
- **No migrations** (`git diff --name-only a67f76e c67fd2c -- supabase/` is empty), no env-var changes,
  no new dependencies, no nginx/Forge changes (body limit already 20M per
  `deploys/2026-09-09-tpl-011-video-upload-body-limit`).
- Target: `https://app.ohmyclient.io`, Forge server `3123752`, host `forge@34.158.58.133`, checkout
  `/home/forge/app.ohmyclient.io` on the `release` branch (deploy.sh syncs it to `origin/release`).
- Previous prod: `main@5f2369a` (WONB-018/019), release `3680ffe`, BUILD_ID `eg46F8RozAOtTEZ_2yaLt`,
  built 2026-08-28T10:44:32Z; app daemon 746791 pid 3936076, worker 801730 pid 3936129, uptime 12 days.
- Executed from the release worktree `../whatsapp-crm-tpl-011-worktree` on a temporary branch
  `release-tpl-011` at `c67fd2c` (`.env.local` + `.env.production.local` byte-identical to the primary
  checkout). The dirty primary checkout was not touched.

## Pre-Flight Checklist (2026-09-09, times UTC)
- [x] `origin/main` = `c67fd2c4918558241864ac57305c692aeb1247a0` (fetched 14:28Z). PR #154 merged
      14:26:19Z; its only status check is CodeRabbit = SUCCESS. **This repo has no GitHub Actions
      workflows** (`.github/workflows` absent), so "CI green" was established locally at `c67fd2c`:
      - `vitest run`: **434 files passed, 4 skipped; 4,419 tests passed, 21 skipped, 2 todo, 0 failed**
        (20.4 s, log `scratchpad/ci-gate-c67fd2c.log`).
      - `eslint`: 149 errors / 20 warnings repo-wide, **all pre-existing**. Only one sits in a file this
        release touches (`wa-template-form-dialog.tsx:35`, `react-hooks/set-state-in-effect`) and that
        line is unchanged since `a67f76e`; the diff only changed `handleChange` near line 50.
      - `next build` rehearsal (`RELEASE_DRY_RUN=1 scripts/release.sh`): compiled, 83/83 static pages,
        secret scrub + credential scan clean, 127 MB / 6,723 files, no `.next/standalone/.env` staged,
        `video-header-hint` in 1 static chunk. Stage dir deleted afterwards.
- [x] Migrations: none. deploy.sh's `supabase db push --linked --include-all` had nothing to apply.
- [x] Secrets / env vars: none added or changed. release.sh scrubs every `.env*` from the bundle.
- [x] Restore point: the previous release bundle `3680ffe` fetched into the worktree as local ref
      `release-backup-3680ffe` (not pushed) — rollback is a force-push of that ref, not a rebuild.
      No DB backup: nothing in this release touches the schema.
- [x] Release branch `release-tpl-011` pushed via `rtk proxy git push`, `git ls-remote` → `c67fd2c…`.
- [x] nginx: `client_max_body_size 20M` (global `conf.d/uploads.conf`); **no `proxy_read_timeout` for
      `app.ohmyclient.io`** → nginx default **60 s** (plan R3: Kapso fetches the video and pushes it to Meta
      inside the synchronous create request; a large video on a slow Kapso fetch could hit this).
- [x] **Disk incident (blocked the deploy for ~8 min).** 14:31Z `df`: `/dev/root 29G used 28G, 517 MB
      free (99 %)` — below deploy.sh's `DEPLOY_MIN_FREE_MB=1500`, and its `git reset --hard` sync runs
      *before* that check, so a push would have swapped `.next/` under the live process and aborted without
      a restart. Release **not** pushed; blocked-state artifact + ask sent to team-lead. Freeing space needs
      root (`forge@` sudo = `supervisorctl` only; no `FORGE_API_TOKEN` locally). Read-only survey:
      `/var/log/journal` 2.8 GB (the forge-visible `journalctl --disk-usage` said 194 MB), `/var/cache/apt`
      547 MB, docker build cache 1.69 GB reclaimable, `/var/log/syslog.1` 101 MB, `~/.npm` 87 MB.
      **Cleared by the user as root via `gcloud compute ssh` (14:3xZ): `apt-get clean` +
      `journalctl --vacuum-size=200M`** (the journal really was ~2.7 GB). Docker cache and any orphaned
      journal dirs left untouched. Re-checked 14:36:56Z: `/dev/root 29G used 25G, **3,682 MB free (88 %)**`.
      Follow-up worth a kanban item: the box will fill again — 17 sites on a 29 GB root, journald
      unbounded; set `SystemMaxUse=` in `/etc/systemd/journald.conf` and schedule `apt-get clean`.
- [x] Box health before deploy (14:37Z): load 0.30, 876 MB RAM available, both daemons RUNNING, tree
      clean apart from the pre-existing ` M supabase/.temp/cli-latest`.
- [x] Prod test tenant: **none pinned** (`ui-map/environments.md` prod row TODO, `secrets.local.json` dev
      only). User decision: deploy only; authenticated smoke + I-2 deferred to the user's own account.
- [x] Wednesday deploy, no weekend risk.

## Runbook (as executed)
```
# worktree ../whatsapp-crm-tpl-011-worktree, branch release-tpl-011 @ c67fd2c, tree clean
git branch release-tpl-011 c67fd2c && git checkout release-tpl-011
rtk proxy git push origin release-tpl-011:refs/heads/release-tpl-011 && git ls-remote --heads origin release-tpl-011   # c67fd2c ✓
git fetch origin refs/heads/release:refs/heads/release-backup-3680ffe                                                  # local restore point
SOURCE_REF=release-tpl-011 bash scripts/release.sh          # 14:37:09Z → 14:39:17Z
git ls-remote --heads origin release                         # 040eead ✓ (was 3680ffe)
# Forge auto-deploys `release`; polled RELEASE.json + supervisor on the box every 15 s
# post-deploy: scratchpad/postdeploy-box.sh over ssh (read-only) + public curls below
rtk proxy git push origin --delete release-tpl-011           # temp branch removed; worktree back on feature/tpl-011
```
release.sh tail:
```
→   building release-tpl-011 @ c67fd2c        node v22.21.1
✓ Compiled successfully in 13.6s
✓ Generating static pages using 7 workers (83/83) in 425ms
→   BUILD_ID E55lhdggn6bYvU_D4H__k
→ Scrubbing secrets from the bundle / Scanning bundle for inlined credentials →   clean
 + 3680ffe...040eead 040eead93688e14b11aebdf332686de14ea98a45 -> release (forced update)
✓ Released release-tpl-011 @ c67fd2c → origin/release (040eead)
```

## Deploy facts (Forge, 2026-09-09)
| time (UTC) | event |
|---|---|
| 14:38:42 | bundle built locally (`RELEASE.json.built_at`) |
| 14:39:17 | `release` force-pushed → `040eead` |
| 14:39:29 | box still `5f2369a`, pids 3936076 / 3936129 |
| 14:39:44 | `RELEASE.json` on the box reads `c67fd2c` (checkout synced, ≈ 27 s after the push) |
| ~14:39:58 | app daemon 746791 restarted → **pid 1109129** |
| ~14:40:04 | worker daemon 801730 restarted → **pid 1109313** |
| 14:40:28 | both RUNNING (uptime 0:00:31 / 0:00:26); `.next/BUILD_ID` = `E55lhdggn6bYvU_D4H__k` = `RELEASE.json.build_id`; git HEAD `040eead` on `release`; only dirt ` M supabase/.temp/cli-latest` (pre-existing) |
| 14:40:35 | public `/api/health` **200** (`{"status":"ok"}`), `/login` **200**, `/` **307** → login (expected) |

## Post-Deploy Verification (all read-only, all PASS)
| check | result |
|---|---|
| RELEASE.json `source_commit` | `c67fd2c4918558241864ac57305c692aeb1247a0`, `source_ref: release-tpl-011`, node v22.21.1 |
| BUILD_ID on disk = RELEASE.json = served | `E55lhdggn6bYvU_D4H__k`; the live `/login` HTML embeds the new BUILD_ID **1×** and the old `eg46F8RozAOtTEZ_2yaLt` **0×** (baseline HTML captured 14:33Z had the old one 1×) — rendered by the new process, not just new files on disk |
| supervisor restart proof | app 746791: pid 3936076 (12 d) → **1109129**; worker 801730: pid 3936129 (12 d) → **1109313**; both RUNNING; worker log `Workers started: campaign, event-dispatch, receipt, email-send`; app log `✓ Ready in 762ms` on :3100 |
| bundle carries TPL-011 | `.next/static`: 1 chunk with `video-header-hint`, 1 with the `video/3gpp` accept list; `.next/server`: 10 files containing `video/mp4`; `src/messages/{en,zh-HK}.json` each carry `videoHeaderHint` (next-intl reads them at runtime) |
| unauth 16 MB `video/mp4` POST to `/api/dashboard/upload?bucket=wa-template-media` | **401** `{"error":"Unauthorized"}` in 16.9 s — nginx passed the whole body, route rejected at auth before reading it (nothing written) |
| unauth 21 MB same | **413** nginx page in 0.42 s — 20M global cap still the ceiling |
| unauth 184 KB real mp4 same | **401** — no anonymous write path |
| disk after deploy | 3,679 MB free (88 %); `package-lock.json` unchanged so deploy.sh skipped `npm ci` |
| login-page chunk set | 13 chunk URLs before and after, identical — the login route has no TPL-011 code; BUILD_ID is the served-build proof |

Noted, unrelated to this release: the app log still boots with `next start` + the known `output: standalone`
warning (#120); the last pre-restart log line was a real tenant's `Template "mid_autumn_2026_promo" with
language "zh_HK" already exists` 400 (expected application behaviour).

## Smoke (unauthenticated only, per user decision)
`/api/health` 200 · `/login` 200 · `/` 307 → `/login` · upload route reachable and auth-gated (401) · nginx
body ceiling unchanged (413 at 21 MB). No authenticated dashboard walk was run (no pinned prod test tenant;
user will verify with their own account).

## I-2 — Kapso video handle: DEFERRED — user verifies manually with own account
Not executed by this release (user decision; no prod users, tenants or templates created). Manual checklist
for the user, on `https://app.ohmyclient.io`:
1. Dashboard → **WA Templates** → **Create Template**. Name e.g. `tpl011_video_verify_<yyyymmddhhmm>`,
   category **Marketing**, language **en**, body text of your choice.
2. Header = **Video** → upload an mp4 ≤ 16 MB (H.264 video + AAC audio, or no audio; 3GP also accepted).
   Expected: the upload finishes and an inline `<video>` preview appears; the file lands at
   `wa-template-media/<tenant-id>/<timestamp>.mp4`.
3. **Submit.** Expected (= I-2 *verified*): the dialog closes and the row shows **pending** (Kapso minted
   the Meta `4:` handle for `video/mp4` and Meta accepted the template).
   - If instead the dialog shows `Kapso media ingest failed (4xx): …` naming the mime type or delivery and
     the row stays **draft** → that is plan R1's "Kapso rejects video ingest" path: do not retry, do not
     change config; report the exact message (feature blocked at provider level).
   - Any other error → report verbatim as *inconclusive* (a 60 s nginx `proxy_read_timeout` would surface
     as a 502/504 on a large video; retry with a ≤ 1 MB clip to separate size from acceptance).
4. Within ~5 min (Forge scheduled `sync-templates` job, or the Meta status webhook) the row should move to
   **approved** or **rejected** with a reason — that is the only proof of plan contract 2 against Meta.
5. Regression: create one **Image**-header template the same way → still submits to **pending**.
6. Cleanup: delete only the templates you created (and, if you want the bucket tidy, only those exact
   `wa-template-media/<tenant-id>/<timestamp>.mp4|png` objects — never a folder sweep; memory
   `principle_cleanup_deletes_only_what_the_run_created`).

## Rollback Procedure (not executed)
ETR ≈ 1–2 min (no rebuild, no migrations):
```
cd /Users/xavierau/Code/js/whatsapp-crm-tpl-011-worktree
rtk proxy git push --force origin release-backup-3680ffe:refs/heads/release    # exact previous bundle = main@5f2369a
git ls-remote --heads origin release                                           # must read 3680ffe…
# Forge redeploys: confirm RELEASE.json source_commit 5f2369a, both pids changed again, /api/health 200
```
Slower documented alternative (≈ 6 min): `SOURCE_REF=<branch at 5f2369a> bash scripts/release.sh`. The only
user-visible reversal is the template form losing the Video header option; templates already created with a
VIDEO component stay in the DB and still render in edit (the pre-TPL-011 code reads them as image/unknown).

## Observability
- App daemon log `/home/forge/.forge/daemon-746791.log`, worker `/home/forge/.forge/daemon-801730.log`;
  grep `media ingest` for Kapso video-ingest failures after the user's first video template.
- nginx site error log `/var/log/nginx/3123752-error.log` (`access_log off` — 413s leave no access line).
- Disk: `df -h /` — 3.6 GB free at deploy; journald + apt cache were the growth; see the disk incident note.

## Cleanup (created vs deleted)
| item | created | deleted |
|---|---|---|
| remote branch `release-tpl-011` @ c67fd2c | yes (14:30Z) | **yes** (14:41Z, `ls-remote` empty) |
| local branch `release-tpl-011` in the worktree | yes | yes; worktree restored to `feature/tpl-011` |
| local ref `release-backup-3680ffe` (worktree, not pushed) | yes | **kept** as the rollback handle; delete once the release is accepted |
| `origin/release` `3680ffe` → `040eead` (orphan, force-pushed by design) | replaced | n/a |
| scratchpad: `tpl011-verify.mp4`, `tpl011-regress.png`, `postdeploy-box.sh`, `*.log`, `login-*.html`, `*.resp` | yes | session-scoped; `16mb.bin` / `21mb.bin` removed after the probes |
| release.sh dry-run stage dir under `$TMPDIR` | yes | yes |
| prod users / tenants / templates / storage objects | **none** | **none** |

## Outcome
2026-09-09 14:28–14:42Z. Deployed `c67fd2c` (BUILD_ID `E55lhdggn6bYvU_D4H__k`, release `040eead`) to
production; both daemons restarted with new pids; health 200; body-limit probes 401/413 as expected; no
migrations; disk incident cleared by the user (517 MB → 3.6 GB free) before the push. I-2 deferred to the
user's manual check with their own account. Handed back to team-lead.
