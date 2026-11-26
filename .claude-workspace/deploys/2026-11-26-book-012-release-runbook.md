---
id: deploys/2026-11-26-book-012-release-runbook
type: deploy
author: dev
created: 2026-11-26
status: executed
supersedes: null
superseded_by: null
related: [kanban:BOOK-012, kanban:TPL-012, kanban:BUILD-FONT-001, github:230, github:228, github:227, github:231, github:232, artifacts/2026-11-26-book-012-classifier-default-on-handoff, artifacts/2026-11-26-book-012-r2-review-fixes-handoff, artifacts/2026-11-26-book-012-release-handoff, artifacts/2026-11-26-book-012-migration-094-handoff, artifacts/2026-11-26-build-font-001-handoff, artifacts/2026-11-26-book-012-release-r2-handoff, deploys/2026-11-22-book-009-010-release-runbook]
---

# Deploy: BOOK-012 classifier on by default (+ TPL-012, BUILD-FONT-001), migration 094: `main` @ `ffcf73ac` to production

**Final outcome: RELEASED 2026-11-26 05:39:45Z.** `main` @ **`ffcf73ac`** (BOOK-012 + TPL-012 + BUILD-FONT-001) →
`origin/release` **`b8976f99`**, BUILD_ID **`zhPLsPnYAGCuNAHqgZBzJ`**, Forge deploy **84057118**. deploy.sh's db push:
"Remote database is up to date." (094 was applied ahead at 04:51Z). Fresh pids 2511387 (app) / 2511460 (worker),
`/api/health` 200. See "Resumed release (r2)" below. The first attempt's record follows unchanged.

**First attempt: BLOCKED at the build, 2026-11-26 04:42Z. Nothing reached prod.** `next build` (Turbopack, Next 16.3.4)
failed twice in a row with 327 errors, one for each `next/font/google` Noto Sans HK font slice:
`Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'`, then
`next/font/google queries have exactly one entry`. release.sh stops before its push, so `origin/release` is still
**`f495266e`**. Prod still serves `main@0c41a4df` (pids 626877 / 626977, unchanged). As of 04:42Z migration 094 was
not applied (ledger tail 092, 093) and the stored-false tenants were {bicho, kushiro}.

**Update 04:51Z: migration 094 has now been applied ahead of the code deploy** (owner ruling 2026-11-26, 1y). Kushiro
and bicho now have `aiRoutingEnabled` true (rev 2→3 and 6→7), and the ledger tail is 094. Prod code is still
`0c41a4df`. See "094 applied ahead of deploy" below.

Done before the block: PR #230 squash-merged into develop, and develop merged into main through PR #228. So
`main` now holds BOOK-012 and TPL-012, neither of them deployed.

Stage: POC. Hosting: the existing Forge box (server 1149990 / site 3123752). Go: owner 2026-11-26 ("yes merge and
release"), relayed by main in brief BOOK-012 release. All times are UTC.

## Scope
- `main` before: **`0c41a4df`** (= prod). `main` now: **`38399078`** = merge of PR **#228** (develop
  `0715b4eb` → main, 04:27:59Z), tree **`51e41efe`**.
  - **BOOK-012** (#230, squash **`0715b4eb`**, 04:17:39Z): the booking-intent classifier is on by default, and
    `aiRoutingEnabled` is an opt-out. r2 also routes a retry after a fallback/error classification. Migration
    **094_booking_ai_routing_default_on**.
  - **TPL-012** (#227, `c37fdba0`, merged to develop 2026-11-24): edit Meta-linked templates in place. It was
    unreleased and rides along, because the brief releases develop as a whole. No migration.
  - #226: BOOK-009/010 release records (docs only).
- PR #228 already existed: it was opened 2026-11-24 as the TPL-012 release PR. I updated its title and body to
  name BOOK-012 and merged it with a merge commit (`--match-head-commit 0715b4eb`).
- No change to `package.json`, `package-lock.json`, `deploy.sh`, `scripts/release.sh`, `.env.example`,
  `src/app/api/cron` or `scripts/cron` (`git diff --stat 0c41a4df 38399078` over those paths is empty), and
  `src/app/layout.tsx` (the font config) is unchanged too.
- Gate parity: tree `51e41efe` == develop tip == `7afa7622`. Outside the workspace it equals `c0ac99a5`, the
  r2 gated commit (vitest 726 files passed / 8,422 tests, tsc exit 0, under the heavy lock). No re-run.

## Pre-flight (all pass)
| step | result |
|---|---|
| box (04:11:30Z, site command 14678053) | RELEASE.json source_commit `0c41a4df`, BUILD_ID `ByP1OESC_Ry3XVBnpk-wX`; disk **55 %** used (26,491 MB free), MemAvailable 1,720 MB, swap 19 MB free, load 0.21; app daemon-746791 pid 626877, worker daemon-801730 pid 626977 (up 3 d 14 h) |
| Gemini (AC-4, 04:12:39Z, site command 14678087) | one Decisions API call from the box with the prod `GEMINI_API_KEY` (read in-process from the site `.env`, never printed), model `gemini-decision-1`, canned input with no diner data: **HTTP 200**, choice `booking`, confidence 0.98. No 429, so no quotaId |
| GET-before (04:12:57Z) | `id, slug, name, booking_config, md5` for all 7 restaurants, Management API (keychain "Supabase CLI" token, `read_only: true`). Session scratch `…/scratchpad/rel/booking-config-before.json`, mode 600, sha256 `5fa94630…adb362e6`. Not committed: the repo is public |
| stored-false set | exactly **bicho** (`55f33c80-62c2-4050-8330-5b6c38ea804f`, mode simple, rev 6) and **kushiro** (`96676002-4ba4-46cc-966c-061adc5d26f1`, mode external, rev 2). Matches the brief |
| other restaurants | oh-my-client aiRoutingEnabled true, rev 2. cheung-ying-hong, oh-my-agent, thai-ox and wall-street-bar-lounge have no key and no rev, mode off (md5 `e035f28c…` each) |
| ledger | 93 rows, 001–093; repo has 94 files. Only **094** is pending (in repo and not in the ledger: `['094']`; in the ledger and not in the repo: none) |
| restore point | `origin/release` fetched as local ref **`release-backup-f495266`** (not pushed) |

## Runbook (as executed)
```
cd /Users/xavierau/Code/js/whatsapp-crm--book-012
gh pr merge 230 --squash --match-head-commit 7afa7622…        # 04:17:39Z → develop 0715b4eb
rtk proxy git merge-tree --write-tree origin/main origin/develop   # exit 0, tree 51e41efe (main is an ancestor)
gh pr edit 228 --title … --body-file …; gh pr merge 228 --merge --match-head-commit 0715b4eb…   # 04:27:59Z → main 38399078
rtk proxy git fetch origin refs/heads/release:refs/heads/release-backup-f495266
rtk proxy git checkout -B release-book012 origin/main
cp ../whatsapp-crm/.env.local ../whatsapp-crm/.env.production.local .   # cmp identical, gitignored
timeout 120 rtk proxy git push -u origin release-book012                 # ls-remote 38399078 ✓
SOURCE_REF=release-book012 resource-lock.py heavy -- bash scripts/release.sh   # try 1: waited for the lock, ended 04:36:33Z, exit 1
SOURCE_REF=release-book012 resource-lock.py heavy -- bash scripts/release.sh   # try 2: ended 04:42:11Z, exit 1 (same 327 errors)
```
Not reached: the Forge auto-deploy, deploy.sh's `supabase db push` (094), the daemon restarts, the read-back.

## Build failure
- The excerpts are in `deploys/evidence/2026-11-26-book-012-release/release-sh-try{1,2}-head.log`: first 60 lines
  and last 3 of each 11,807-line log, ANSI stripped. The full logs are in session scratch.
- Both runs: `npm ci` OK, `✓ Running next.config.ts`, then `Turbopack build failed with 327 errors`. Every error is in
  `[next]/internal/font/google/noto_sans_hk_5e297ec2.module.css`. Inter (the other `next/font/google` font) is not in
  the errors.
- Not the network: `fonts.gstatic.com` resolves (DNS 100.64.0.2). The css2 request for Noto Sans HK 400/500/700 with
  a Chrome UA returns 200 (424 KB) with **327 `src: url(...)` entries**, all plain
  `https://fonts.gstatic.com/s/notosanshk/v36/<id>.<n>.woff2` URLs. The 327 matches the error count.
- Not this release's code: no font, Next, lockfile or config change since `0c41a4df`, which built on 2026-11-22
  13:57Z with the same lockfile.
- Hypothesis (unconfirmed, looked in: release logs, a manual css2 fetch, layout.tsx): the Google Fonts response changed
  since 11-22 and Turbopack's font-URL replacer in Next 16.3.4 now rejects it. If so, a build of the current prod
  commit `0c41a4df` would fail the same way (not run).

## Ready to resume (when the build is fixed)
1. `SOURCE_REF=release-book012 resource-lock.py heavy -- bash scripts/release.sh` (or the fixed main tip pushed as
   `release-book012`). Then `git ls-remote origin refs/heads/release` should be the new release SHA.
2. Forge deploys `release`: deploy.sh runs `supabase db push --linked --include-all` under `set -e` **before** both
   restarts. **094 is already applied (04:51Z, section below), so this db push should find nothing pending** ("Remote
   database is up to date"). Re-check first: a `--dry-run` that lists anything (094 included) means the ledger
   changed since 04:51Z, so stop and look.
3. Verify (AC-2/AC-3): `booking_config` should be unchanged from the 04:51Z read-back (bicho and kushiro
   `aiRoutingEnabled` true at rev 7 and 3, unless an admin saved since; md5 as in
   `deploys/evidence/2026-11-26-book-012-migration-094/readback.log`); box
   `supabase migration list --linked` shows 094; RELEASE.json source_commit == main tip; fresh uptimes for daemon-746791 / 801730;
   public `/api/health` 200; `grep -rl earlierOutcome .next/server` on the box finds the r2 rule.
4. Owner test: send 想定枱 to Kushiro → the 立即訂位 CTA; `inbound_classifications` has a row with outcome
   `booking_reply`.

## 094 applied ahead of deploy (dev, 2026-11-26 04:47–04:53Z)
Owner ruling 2026-11-26 (1y), relayed by main in brief BOOK-012 "migration-only release step": Kushiro gets the
classifier now, because prod code `0c41a4df` already reads `aiRoutingEnabled: true` as on. The owner accepted that the
old webhook-retry gap (fixed by BOOK-012 r2, not deployed) applies to Kushiro until the code deploy. Data only: no
code deploy, no release.sh, no restart, no `agent_config` change. Evidence:
`deploys/evidence/2026-11-26-book-012-migration-094/`.

| time (UTC) | step | result |
|---|---|---|
| 04:47:46 | box before (site command 14678838) | RELEASE.json source_commit `0c41a4df`, build_id `ByP1OESC_Ry3XVBnpk-wX` == `.next/BUILD_ID`; daemon-746791 pid **626877**, daemon-801730 pid **626977** (up 3 d 14 h 48 m); `/api/health` 200 |
| 04:50:29 | GET-before: `id, slug, booking_config, md5` for all 7 restaurants (Management API, keychain "Supabase CLI" token, `read_only: true`) | session scratch `…/scratchpad/m094/booking-config-before.json`, mode 600, sha256 `72b9a554…ce29d9f7b`. Stored-false set = exactly **bicho** `55f33c80-62c2-4050-8330-5b6c38ea804f` (rev 6) and **kushiro** `96676002-4ba4-46cc-966c-061adc5d26f1` (rev 2), as the brief expected. Ledger 93 rows, tail 093 |
| ~04:50:40 | `supabase link --project-ref uzimqndenngebzgndlhd` in this tree (HEAD = origin/main `38399078`, CLI 2.109.1) | linked; no DB password given (every later command printed "Initialising login role...") |
| 04:50:53 | `supabase db push --linked --include-all --dry-run` | exit 0, "Would push these migrations: • 094_booking_ai_routing_default_on.sql", nothing else (`dryrun.log`) |
| 04:51:11–04:51:19 | `supabase db push --linked --include-all` | exit 0, "Applying migration 094_booking_ai_routing_default_on.sql... Finished" (`push.log`) |
| ~04:51:30 | `supabase migration list --linked` + ledger query | 94 rows, every local == remote, 094 remote-applied; ledger tail 094, 093, 092 (`migration-list.log`) |
| ~04:51:40 | read-back (same query, `read_only: true`) | bicho false→**true**, rev 6→**7**; kushiro false→**true**, rev 2→**3**; every other key byte-identical to GET-before for both. The other 5 restaurants' md5 unchanged (oh-my-client `540ec34c…`, four × `e035f28c…`). Scratch `booking-config-after.json` sha256 `d874d9ad…099455ef` (`readback.log`) |
| 04:51:58 | box after (site command 14678892) | RELEASE.json still `0c41a4df` / `ByP1OESC_Ry3XVBnpk-wX`; pids **626877 / 626977 unchanged** (up 3 d 14 h 52 m); `/api/health` 200 on the box and from this Mac |
| 04:53 | tree cleanup | the 8 link-cache files `supabase link` wrote under `supabase/.temp/` (gitignored) moved to session scratch, so this tree is no longer linked to prod; `supabase/.temp/cli-latest` (tracked) unchanged |

Effect: the app reads `booking_config` per inbound message, so the classifier is live for Kushiro and bicho from their
next unmatched message, with no restart. Not yet seen on real traffic.

**Resumed deploy:** deploy.sh's `supabase db push --linked --include-all` should now find nothing pending. If its dry
run lists 094 or anything else, the ledger changed after 04:51Z: stop.

**Rollback of 094's data, now** (re-disables the classifier for exactly the two tenants it flipped; rev bumped with
the same CASE so a writer holding the post-094 blob re-reads instead of writing true back). Run through the Management
API (`read_only: false`); ETR about 1 minute; no restart needed. It does not remove the ledger row, so a later db push
does not re-run 094:
```sql
UPDATE public.restaurants
SET booking_config = booking_config || jsonb_build_object(
  'aiRoutingEnabled', false,
  'rev', CASE
    WHEN jsonb_typeof(booking_config->'rev') = 'number'
      AND (booking_config->'rev')::numeric = trunc((booking_config->'rev')::numeric)
    THEN to_jsonb(trunc((booking_config->'rev')::numeric) + 1)
    ELSE '1'::jsonb
  END
)
WHERE id IN ('96676002-4ba4-46cc-966c-061adc5d26f1', '55f33c80-62c2-4050-8330-5b6c38ea804f');
```

## Resumed release (r2) (dev, 2026-11-26 05:27–05:52Z)
Brief BOOK-012 release (resume), owner go 2026-11-26 ("merge and release"). Evidence:
`deploys/evidence/2026-11-26-book-012-release-r2/` (logs redacted: the seeded admin and the builder email).

| time (UTC) | step | result |
|---|---|---|
| 05:28:09 | `gh pr merge 231 --squash --match-head-commit 978d3ed1…` (BUILD-FONT-001, CodeRabbit green) | develop **`4e870cb3`** |
| 05:28 | `git merge-tree --write-tree origin/main origin/develop` | exit 0, tree `b5990191`, no conflicts (main's only extra commit was the #228 merge) |
| 05:29:16 | PR **#232** develop → main, `gh pr merge 232 --merge --match-head-commit 4e870cb3…` | main **`ffcf73ac`**. `ls-tree` has `src/app/fonts/noto-sans-hk.css`; `git grep` finds `decideRetry` (route-booking-intent.ts:72,83); `c37fdba0` (TPL-012) and `0715b4eb` (BOOK-012) are ancestors |
| 05:30:06 | box pre-flight (site command 14679677, `box-preflight.log`) | RELEASE.json `0c41a4df` / `ByP1OESC_Ry3XVBnpk-wX`; pids 626877 / 626977; disk **55 %** (26 GB free); swap 1000/1023 MB used (same as 04:11Z; no build on the box); health 200. The box's own `db push --dry-run` errors "Remote migration versions not found in local migrations directory": expected, its checkout (0c41a4df) has no 094 file |
| 05:30 | pending check from the Mac: ledger (Management API, `read_only`) vs `git ls-tree origin/main supabase/migrations` | 94 = 94, nothing pending either way |
| 05:30:58 | GET-before `booking_config` / `agent_config` md5, all 7 (`readback.log`) | identical to the 04:51Z read-back: bicho true rev 7 `8a605017…`, kushiro true rev 3 `5f7e6b15…` |
| 05:31 | `git checkout -B release-book012 origin/main`; `.env.local` / `.env.production.local` cmp-identical to the primary checkout; `git push origin release-book012` | fast-forward `38399078..ffcf73ac`; ls-remote `ffcf73ac` |
| 05:31:21–05:38:57 | `SOURCE_REF=release-book012 resource-lock.py heavy -- bash scripts/release.sh` (waited for another repo's lock holder) | **exit 0**, BUILD_ID `zhPLsPnYAGCuNAHqgZBzJ`, secret scan clean, `origin/release` `f495266e` → **`b8976f99`** (`release-sh-tail.log`) |
| 05:38:56–05:39:45 | Forge auto-deploy **84057118** (`forge-deploy-84057118.log`) | sync to b8976f9; 26,472 MB free; lockfile unchanged, npm ci skipped; **db push: "Remote database is up to date."**; seeder idempotent; app and worker restarted, both RUNNING |
| 05:40:13 | box after (site command 14679948, `box-after.log`) | RELEASE.json **`ffcf73ac`** / `zhPLsPnYAGCuNAHqgZBzJ` == `.next/BUILD_ID`; daemon-746791 pid **2511387** (up 0:00:33), daemon-801730 pid **2511460** (up 0:00:30); health 200; `earlierOutcome` in 2 `.next/server` files (`console.warn("[Book… earlierOutcome`); `Noto Sans HK Fallback` in `.next/static/chunks/0a5yu-solyosa.css`; migration list 094 local == remote |
| 05:41:02 | public `https://app.ohmyclient.io/login` in Chromium 1208 (playwright-core, locale zh-HK, 1440×900; `prod-login-zh.json`/`.png`) | **200**, `lang` zh-HK, `--font-cjk` = `"Noto Sans HK", "Noto Sans HK Fallback"`, 328 Noto faces declared; served CSS `0a5yu-solyosa.css` contains `Noto Sans HK Fallback`; 1 font response (Inter woff2, 200), **0 font 404s**, 0 failed requests. One non-font 404: `/favicon.ico` (see note) |
| 05:41:28 | read-back (`readback.log`) | all 7 `booking_config` and `agent_config` byte-identical to 05:30:58Z; kushiro / bicho `aiRoutingEnabled` true at rev **3 / 7**. `inbound_classifications` last 2 h: `booking_reply` 5 (last 05:25:55Z), `fallback` 2 |
| 05:50:15 | logs 10 min after restart (site command 14680138, `box-logs-10min.log`) | pids unchanged (up 0:10:36 / 0:10:33), health 200. Worker since its banner: `Workers started: … agent-reply`, then **2** `[sweepIntegrationQueues] pruneOrphanIntegrationEvents failed … Bad Request` (pre-existing, 1,769 in the log). App: banner, `✓ Ready in 693ms`, the known `next start`/standalone warning, **2** `[Kapso] Error listing templates: WhatsApp configuration not found` (known). **No new error class.** |

Note on `/favicon.ico` 404: `src/app/favicon.ico` exists since the initial commit, and nothing that serves it changed
in this release (`git diff --stat 0c41a4df ffcf73ac -- src/app/favicon.ico src/middleware.ts src/proxy.ts
next.config.ts` is empty). So it predates this deploy (inferred; the old build was not checked).

## Rollback
- **Code (deployed 05:39Z), important:** force-pushing the old bundle alone **no longer works**. `f495266e`'s checkout
  has no 094 file, and the ledger has 094, so deploy.sh's `supabase db push` fails under `set -e` ("Remote migration
  versions not found in local migrations directory", seen on the box at 05:30Z) **before** the restarts: Forge reports
  a failed deploy and the new code keeps serving. Do not use `migration repair --status reverted 094` for this:
  a later release would re-run 094. Instead build a rollback bundle that is old code plus the 094 file (needs
  Xavier's OK for the force-push of `release`; ETR about 10 min):
  ```
  git checkout -b rollback-book012 0c41a4df
  git checkout ffcf73ac -- supabase/migrations/094_booking_ai_routing_default_on.sql
  git commit -m "chore: rollback bundle (0c41a4df + applied migration 094)" && git push -u origin rollback-book012
  SOURCE_REF=rollback-book012 python3 ~/.claude/bin/resource-lock.py heavy -- bash scripts/release.sh
  ```
  `0c41a4df` still loads Noto Sans HK through `next/font/google`, so that build can hit the BUILD-FONT-001 failure if
  Google serves the `&` URLs again; retry later, or add `src/app/fonts/noto-sans-hk.css` + the layout change from
  `4e870cb3` to the rollback branch. Previous release for reference: `f495266e` (local ref `release-backup-f495266`).
  The old code also reads true as on, so the flipped tenants keep the classifier until the data rollback below.
- **First attempt, code (historical):** nothing to roll back then; main was ahead of prod (`38399078` vs `0c41a4df`).
- **094 data:** the SQL below (same statement as in "094 applied ahead of deploy"). Leaves the ledger row.
- **094 data** (re-disables the classifier for exactly the two tenants it flips; rev bumped with
  the same CASE so a writer holding the post-094 blob re-reads):
  ```sql
  UPDATE public.restaurants
  SET booking_config = booking_config || jsonb_build_object(
    'aiRoutingEnabled', false,
    'rev', CASE
      WHEN jsonb_typeof(booking_config->'rev') = 'number'
        AND (booking_config->'rev')::numeric = trunc((booking_config->'rev')::numeric)
      THEN to_jsonb(trunc((booking_config->'rev')::numeric) + 1)
      ELSE '1'::jsonb
    END
  )
  WHERE id IN ('96676002-4ba4-46cc-966c-061adc5d26f1', '55f33c80-62c2-4050-8330-5b6c38ea804f');
  ```

## Cleanup
| item | state |
|---|---|
| remote `release-book012` (`ffcf73ac` = main tip after r2) | deleted after the release (r2); it was only release.sh's `SOURCE_REF` |
| local ref `release-backup-f495266` | kept as the rollback reference (refs are shared, so removing the worktree keeps it) |
| box `/home/forge/rel-book012-tmp/` (Gemini probe script, no secret) | deleted 04:42Z (site command 14678742) |
| worktree `../whatsapp-crm--build-font` (r2, 05:5xZ) | removed by hand from the primary checkout: wt-finish refused (squash merge, ancestry); every file the branch touched is identical in origin/main and the tree had no changes or untracked files. Slot released (`worktree_remove.py`), `git worktree remove`, `git branch -D fix/build-noto-sans-hk-font` (was `978d3ed1`), remote branch deleted. Restore: `git worktree add ../whatsapp-crm--build-font -b fix/build-noto-sans-hk-font 978d3ed1` |
| worktree `../whatsapp-crm--book-012` (r2) | removed after this records PR was pushed: see the r2 handoff `artifacts/2026-11-26-book-012-release-r2-handoff` (cleanup field) |
| docs PR into main, kanban BOOK-012 / TPL-012 / BUILD-FONT-001 → done, BUILD-FONT-002 backlog | this records PR (r2) |
| tree's Supabase link to prod (04:50Z, for the 094 step) | removed 04:53Z (link-cache files moved to session scratch `…/scratchpad/m094/temp-link-quarantine/`) |
