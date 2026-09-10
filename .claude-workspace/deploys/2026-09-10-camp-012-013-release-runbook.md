---
id: deploys/2026-09-10-camp-012-013-release-runbook
type: deploy
author: devops-engineer
created: 2026-09-10
status: executed
supersedes: null
superseded_by: null
related: [kanban:CAMP-012, kanban:CAMP-013, github:161, github:162, github:164, github:168, plans/2026-09-10-camp-012-013-guardrail-defaults-and-recipient-rpc, reviews/2026-09-10-camp-012-013-delta-analyzer, deploys/2026-09-10-int-001-release-runbook, deploys/2026-09-09-tpl-011-release-runbook]
---

# Deploy: CAMP-012/013 guardrail defaults + recipient RPCs — `origin/main` @ `4aa7752` to production

**Outcome: DEPLOYED 2026-09-10 07:26Z. All post-deploy checks PASS. No rows created or deleted by this
run (residue 0); no campaign sent.** Prod serves `main@4aa77522`, release `7884616`, BUILD_ID
`3d4MGZIglesEHuevjn8cK`, migrations 078 + 079 applied, both daemons restarted (app pid 1740620, worker pid
1740730), `/api/health` 200.

## Scope
- Ships PR **#164** (`origin/develop` @ `b9f1f250` — GitHub #161 + #162, kanban CAMP-012 / CAMP-013) via PR
  **#168** (`release-camp-012-013` → main, merge commit **`4aa77522ce865109f7d5660aa5e68b527376c86b`**).
  Branch hygiene first: `origin/main` merged INTO the release branch (`740a6923`, clean ort merge, **no
  conflicts**, `git diff --name-only --diff-filter=U` empty, no `<<<<<<<` markers); `git diff origin/develop HEAD`
  empty (tree identical to develop) and the only "removals vs main" are PR #164's own code changes — no
  main-only doc/kanban/INDEX content lost.
- Migration **078** `tenant_campaign_settings_seed_on_create` (data-changing: `plan_monthly_send_limit(text)`,
  AFTER INSERT trigger on `restaurants`, idempotent backfill `ON CONFLICT DO NOTHING`); migration **079**
  `active_members_rpcs` (`active_members_by_tags`, `active_members_by_campaign_selection`, STABLE, 064-style
  REVOKE/GRANT lockdown). App: `resolveSettings()` plan-derived fallback, `checkMonthlyLimit >=`→`>`,
  RPC-paged recipient resolution (`readAllPages`), promo/winback audiences paged (review F1), admin
  campaign-settings GET shares `planDerivedDefaults` (F2).
- **No new env vars** (release diff adds only `PG*`/`RUN_DB_TESTS` reads inside the `RUN_DB_TESTS=1` test file;
  `package.json` gains only the `test:db` script; lockfile unchanged → deploy.sh skipped `npm ci`). Site `.env`
  58 lines before and after.
- Target: `https://app.ohmyclient.io`, Forge server 3123752, `forge@34.158.58.133` (`gcp-accurity-audit-poc`,
  e2-medium), checkout `/home/forge/app.ohmyclient.io` on `release`. Supabase prod = `whatsapp-crm-pro`
  (`uzimqndenngebzgndlhd`, the box's link). SQL run read-only through the Supabase Management API
  (`POST /v1/projects/<ref>/database/query`, token read from the box `.env`, never printed).
- Previous prod: `main@8d8f966` (INT-001 release 2), release `6b9a854`, BUILD_ID `CIN1pCKJCF5rwr4lPldmd`,
  pids 1612332 / 1612702, migrations through 077.
- Executed from worktree `../whatsapp-crm-release-camp-012-013` (`.env.local` + `.env.production.local` copied
  from the primary; the dirty primary checkout untouched). Thursday, 07:15–07:34Z (15:15–15:34 HKT). Go given
  by the orchestrator relaying the user's "release to production now".

## Pre-Flight Checklist
- [x] **Local CI on the release tree (worktree, fresh `npm ci`)**: `tsc --noEmit` exit 0; `vitest run` →
      **536 files passed / 7 skipped; 5,653 tests passed, 46 skipped, 2 todo, 0 failed** (88 s). GitHub checks
      on #164/#168: CodeRabbit only (skipped by policy) — no other CI is configured on this repo.
- [x] **ENTITLEMENT GATE (07:17Z, read-only) — PASS**: 6 restaurants; `plan`: Kushiro
      `96676002-4ba4-46cc-966c-061adc5d26f1` = **growth**, all 5 others (Bicho, Golden Wave, OhMyClient,
      冬蔭牛牛, 長盈行) = **starter**, all `status = active`. `tenant_campaign_settings`: exactly **1 row**
      (Kushiro, id `b2a91782-…`, `monthly_send_limit 10000`, `daily_campaign_limit 1`,
      `updated_at 2026-09-10 04:17:10.096119+00`). No other tenant ≠ starter, no other settings row → proceed.
- [x] **Baseline (07:18Z)**: member_tags 3,047; campaign_members 11; trigger
      `trg_restaurant_seed_campaign_settings` absent (0); the four new functions absent (0);
      `count_active_members_by_tags` (067) present (1). Kushiro's largest tags: `4bc7f3ce…` "5 anniversary_batch 2"
      250 active, `be00e931…` batch 5 250, `1ea3532b…` batch 6 249 (the plan's "744-member live audience" does
      not exist as a single tag; parity was checked on the largest tag and on the 3-tag union).
- [x] **Backup (07:19:32Z, before any migration)**: full-row JSON exports of `restaurants` (6 rows, 5,990 B,
      sha256 `7f82a906a4510eb1…`), `tenant_campaign_settings` (1 row, 700 B, `5a167f5e3130bbbb…`), `member_tags`
      (3,047 rows, 612,198 B, `a6d55dee8f2e61c9…`), `campaign_members` (11 rows, 1,167 B, `eec7330ff45a73a2…`) →
      box `/home/forge/backups/2026-09-10-camp-012-013/*.json` (dir 700, files 600) + a byte-identical copy in the
      session scratchpad `backup/`. Supabase managed backups: 7 daily physical backups, newest
      **2026-09-09T19:25:12Z**, WAL-G on, PITR off. Restore point for code: `origin/release` fetched as local ref
      **`release-backup-6b9a854`** in the release worktree (not pushed).
- [x] **Disk**: 3,286 MB free at 07:16Z, 3,275 MB at push (≥ 2 GB → no cleanup needed; `gcloud` on this Mac is
      bound to another project, so root cleanup would need the user — not required today). RAM avail 2,135 MB.
- [x] **App/box baseline (07:20Z)**: `/api/health` 200, `/login` 200, `/` 307; live `/login` HTML embeds
      `CIN1pCKJCF5rwr4lPldmd` 1×; both daemons RUNNING (1612332 / 1612702, uptime 2:52); worker log 0
      `[Guardrails]` lines, 0 `tenant_campaign_settings missing`; HEAD `6b9a854`; migrations end 077; Redis PONG.
- [x] Migrations reviewed: 078 backfill idempotent (`ON CONFLICT (restaurant_id) DO NOTHING`), Kushiro row
      untouched by construction; 079 additive functions, drop-safe. One-way risk: none (rollback keeps the rows —
      correct data).
- [x] Secrets: none added/changed. Redis untouched. DEV Supabase untouched.
- [x] Weekday (Thursday) afternoon HKT deploy; user-authorised.

## Runbook (as executed)
```
# primary is dirty (user WIP) — never stash/reset; work in a new worktree
git worktree add ../whatsapp-crm-release-camp-012-013 -b release-camp-012-013 origin/develop   # b9f1f250
cp .env.local .env.production.local ../whatsapp-crm-release-camp-012-013/
cd ../whatsapp-crm-release-camp-012-013
git merge --no-ff origin/main -m "Merge origin/main into release-camp-012-013 (runbook/doc commits) before release"   # 740a6923, clean
git diff --name-only --diff-filter=U; grep -rl '^<<<<<<< ' .claude-workspace .claude   # both empty
rtk proxy git push -u origin release-camp-012-013 && git ls-remote --heads origin release-camp-012-013   # 740a6923 ✓
gh pr create --base main --head release-camp-012-013 --title "Release: #161 guardrail defaults + #162 recipient RPCs (migrations 078+079)" …   # PR #168
npm ci && npx tsc --noEmit && npx vitest run            # exit 0 / 5,653 passed
gh pr merge 168 --merge …                               # main 4aa77522
git fetch origin && git merge --ff-only origin/main     # branch = main tip
rtk proxy git push origin release-camp-012-013 && git ls-remote --heads origin release-camp-012-013   # 4aa77522 ✓ (release.sh needs same-named remote branch in sync)
git fetch origin refs/heads/release:refs/heads/release-backup-6b9a854                                  # restore point
SOURCE_REF=release-camp-012-013 bash scripts/release.sh   # 07:23:03Z → 07:25:55Z, exit 0 (off-box build)
git ls-remote --heads origin release                       # 7884616 ✓ (was 6b9a854)
# Forge auto-deployed `release`; polled HEAD / RELEASE.json / supervisor / df every 15 s (below)
rtk proxy git push origin --delete release-camp-012-013    # 07:33Z; worktree + release-backup-6b9a854 kept as rollback handle
```
release.sh tail:
```
→   building release-camp-012-013 @ 4aa7752
✓ Compiled successfully in 26.1s
✓ Generating static pages using 7 workers (84/84) in 714ms
→   BUILD_ID 3d4MGZIglesEHuevjn8cK
→ Scrubbing secrets from the bundle / Scanning bundle for inlined credentials →   clean
 + 6b9a8544...78846167 7884616756b7453cfd90080fb8fe521411497b4a -> release (forced update)
✓ Released release-camp-012-013 @ 4aa7752 → origin/release (7884616)
```

## Deploy facts (Forge, 2026-09-10 UTC)
| time | event |
|---|---|
| 07:25:43 | bundle built (`RELEASE.json.built_at`) |
| 07:25:55 | `release` force-pushed → `7884616` |
| 07:26:27 | box checkout synced: HEAD `7884616`, RELEASE.json `4aa7752` / `3d4MGZIglesEHuevjn8cK` (old pids still up) |
| 07:26:32.64 | `supabase db push --linked --include-all` applied **078 + 079** (= `created_at` of the 5 backfilled settings rows) |
| 07:26:43 | app daemon 746791 → **pid 1740620** RUNNING; worker 801730 STARTING |
| 07:26:58 | worker daemon 801730 → **pid 1740730** RUNNING |
| 07:31:47–07:33:22 | post-deploy verification (below); disk 3,273 → 3,272 MB throughout (no `npm ci`: lockfile unchanged) |

## Post-Deploy Verification (read-only; ALL PASS)
| check | result |
|---|---|
| `SELECT count(*) … WHERE s.id IS NULL` | **0** (settings rows 6 = restaurants 6) |
| Kushiro row byte-identical to gate | id `b2a91782-fe1c-4b0b-a08a-11a891f5082a`, limit **10000**, daily 1, `updated_at 2026-09-10 04:17:10.096119+00` (unchanged) |
| `GROUP BY plan, monthly_send_limit` | `growth/10000 → 1`, `starter/1000 → 5`; the 5 new rows `created_at 07:26:32.642842+00` |
| trigger | `trg_restaurant_seed_campaign_settings` present |
| RPC lockdown (`pg_proc.proacl`) | `active_members_by_tags` and `active_members_by_campaign_selection`: `{postgres=X/postgres,service_role=X/postgres}` — service_role only, `provolatile s`; `plan_monthly_send_limit` (IMMUTABLE) and the trigger fn keep default EXECUTE, by design (078 header) |
| count parity, 1 tag `4bc7f3ce…` | `count_active_members_by_tags` **250** = `active_members_by_tags(rid, tag, NULL, 0)` **250** = `(…, 1000, 0)` **250**; `(…, 1000, 1000)` → 0 (paging terminates) |
| count parity, 3 tags | 067 **749** = 079 unpaged **749** |
| selection RPC, zero UUID | 0 rows |
| RPC timing (`EXPLAIN ANALYZE`, in-DB) | 1 tag unpaged: plan 2.28 ms / **exec 1.58 ms**; 1 tag `p_limit 1000 p_offset 0`: plan 2.22 / **exec 1.64 ms**; 3 tags (749 rows) `1000/0`: plan 2.38 / **exec 2.48 ms**. Plan = Hash Join over `member_tags` idx + Seq Scan `members` (2,479 rows) → Sort → Unique |
| RPC via PostgREST (real wire path, from the box) | service key: 1 tag `p_limit 1000` **200, 250 rows, 0.33 s / 0.28 s** wall, response headers 914 B, `content-range 0-249/250`; 3 tags **200, 749 rows, 0.46 s**; selection zero-UUID **200 []**. anon key: both RPCs **401 `42501 permission denied for function …`** |
| membership tables untouched | member_tags 3,047 / campaign_members 11 (= baseline) |
| provenance | RELEASE.json `source_commit 4aa77522…`, `source_ref release-camp-012-013`, `build_id 3d4MGZIglesEHuevjn8cK` = `.next/BUILD_ID`; HEAD `7884616` on `release`; only dirt ` M supabase/.temp/cli-latest` (pre-existing) |
| served build | `/login` HTML embeds `3d4MGZIglesEHuevjn8cK` 1×, old `CIN1pCKJCF5rwr4lPldmd` 0× |
| daemons | both RUNNING, pids **1740620 / 1740730** (were 1612332 / 1612702), uptime 0:06 at check, no restart loop (`ps` etimes 371 s) |
| worker log | `Workers started: campaign, event-dispatch, receipt, email-send, integration-inbound, integration-outbound`; 0 `[Guardrails]`, 0 `tenant_campaign_settings missing` (worker and app), no error lines since restart |
| public | `/api/health` 200 `{"status":"ok"}`, `/login` 200, `/` 307, `/api/dashboard/campaigns` 401 unauth, `/api/admin/tenants/<kushiro>/campaign-settings` **401 unauth** (auth-gated) |
| admin campaign-settings GET (authenticated, `monthlySendLimit: 10000`) | **not exercised** — no smoke auth exists that does not create prod rows (precedent used a throwaway tenant; forbidden for this release). The DB row it reads is verified above |
| env | site `.env` 58 lines before/after; no vars added |
| disk / RAM | 3,272 MB free (89 %), 2,151 MB RAM avail |

## Behaviour changes to expect (surface to the user; from PR #164 / review F1)
- Promo/winback audiences > 1,000 now resolve completely; an over-quota tenant gets a **blocked** campaign
  where it previously got a silent 1,000-recipient partial send. Expect this on the first send after deploy.
- `checkMonthlyLimit` `>=` → `>`: a 1,000 quota allows exactly 1,000 sends.
- Re-running Kushiro's terminally failed "5 anniversary_batch 6" is a tenant/business action (new campaign),
  not part of this release.
- Pre-existing, unrelated: app log warns `"next start" does not work with "output: standalone"` (supervisor
  command unchanged since before this release).

## Rollback Procedure (ready, NOT executed; ETR ≈ 1–2 min; DB stays)
```
cd /Users/xavierau/Code/js/whatsapp-crm-release-camp-012-013
rtk proxy git push --force origin release-backup-6b9a854:refs/heads/release     # exact previous bundle = main@8d8f966
git ls-remote --heads origin release                                            # must read 6b9a854…
# Forge redeploys: RELEASE.json source_commit 8d8f966, both pids change, /api/health 200, worker "Workers started: …" (6 workers).
```
Migrations stay: 078's rows are correct data and harmless under old code (old code reads them as configured
settings — for starter tenants that equals its hardcoded 1,000 default; Kushiro's row predates this release);
079's functions are unused by the old build. If a DB revert is ever demanded: `DROP TRIGGER
trg_restaurant_seed_campaign_settings ON restaurants; DROP FUNCTION restaurant_seed_campaign_settings(),
plan_monthly_send_limit(text), active_members_by_tags(uuid,uuid[],int,int),
active_members_by_campaign_selection(uuid,uuid,int,int);` — the backfilled rows should still stay. Surface to the
user before rolling back — never silently.

## Observability
- Worker log `/home/forge/.forge/daemon-801730.log` — grep `[Guardrails]`, `tenant_campaign_settings missing`
  (must stay 0; any hit names a tenant whose row was deleted), `Campaign blocked`, `fetchTagMembers`,
  `fetchSelectedMembers`; app log `/home/forge/.forge/daemon-746791.log`.
- DB: the three post-deploy queries above; `active_members_by_tags` per-page time (1.6 ms at 250 rows / 2.5 ms
  at 749 — re-measure before any `pro` tenant exists, per review F5).
- Managed backups: Supabase daily physical (newest 2026-09-09T19:25Z); table exports on the box.

## Cleanup (created vs deleted)
| item | created | deleted |
|---|---|---|
| remote branch `release-camp-012-013` | 07:21Z | **yes** 07:33Z (`ls-remote` empty) |
| PR #168 | merged (`4aa77522`) | n/a |
| worktree `../whatsapp-crm-release-camp-012-013` + local ref `release-backup-6b9a854` | yes | **kept** as the rollback handle until the release is accepted |
| `origin/release` `6b9a854` → `7884616` (orphan, force-pushed by design) | replaced | n/a |
| box `/home/forge/backups/2026-09-10-camp-012-013/` (4 JSON exports, 620 KB) | yes | kept (restore point; delete once accepted) |
| prod rows | **none created, none deleted** (SQL read-only; PostgREST probes were RPC reads) | residue 0 |
| box temp files `/tmp/.q.*`, `/tmp/.h`, `/tmp/.b` | transient | removed by the scripts |

## Outcome
2026-09-10 07:15–07:34Z. Deployed `4aa77522` (release `7884616`, BUILD_ID `3d4MGZIglesEHuevjn8cK`) to
production with migrations 078 + 079 applied; entitlement gate passed before deploy (1 growth / 5 starter, 1
settings row); backfill produced exactly the 5 expected starter/1000 rows and left Kushiro's row byte-identical;
both RPCs present, service_role-only, count-parity with 067 on real tags, 1.6–2.5 ms in-DB / 0.3–0.5 s via
PostgREST; both daemons restarted (pids 1740620 / 1740730); health 200; no prod rows created or deleted.
Rollback handle ready. Handed back to the orchestrator.
