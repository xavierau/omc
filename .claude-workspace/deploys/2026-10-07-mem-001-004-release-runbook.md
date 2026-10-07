---
id: deploys/2026-10-07-mem-001-004-release-runbook
type: deploy
author: devops-engineer
created: 2026-10-07
status: executed
supersedes: null
superseded_by: null
related: [kanban:MEM-001, kanban:MEM-004, github:172, artifacts/2026-10-07-mem-001-backend-handoff, artifacts/2026-10-07-mem-001-frontend-handoff, artifacts/2026-10-07-mem-004-backend-handoff, deploys/2026-09-10-camp-012-013-release-runbook]
---

# Deploy: MEM-001 members table + MEM-004 reachability restore: `main` @ `d73b7e2` to production

**Outcome: DEPLOYED 2026-10-07 08:52Z. All read-only post-deploy checks PASS. Migrations 080 + 081
applied; no prod rows created, changed or deleted by this run.** Prod serves `main@d73b7e2a`, release
`0071fa3`, BUILD_ID `AkWQ9N80t9yjaXRQRWYWu`, both daemons restarted (app pid 2130560, worker pid 2130632),
`/api/health` 200. **The authenticated browser smoke (AC-5) was NOT run**: no prod test account exists
(`ui-map/secrets.local.json` is absent in every checkout, and `environments.md` lists prod `testOrgId` as TODO).
The same paths were verified at the DB and PostgREST layer instead (below).

## Scope
- Ships PR **#172** (`develop` @ `07316f36` → `main`, merge commit **`d73b7e2a1a5e042e82594b6b582b6b3041713c96`**,
  merged 08:41:15Z, mergeStateStatus CLEAN, CodeRabbit SUCCESS). `git diff origin/develop origin/main` after the
  merge = only main-only docs (CAMP-012/013 runbook, INDEX line, kanban): no develop content lost.
- MEM-001: `GET /api/dashboard/members` with `pageSize` ≤ 250, `tagId=none`, and a per-member `quality` object built from
  RPC `member_delivery_quality` (90-day outbound delivery rate), plus a member detail "Contact quality" evidence section.
  MEM-004: an inbound message clears `members.unreachable_at` and writes one `reachability_restored` event.
- Migration **080** `member_delivery_quality`: a STABLE SQL function, REVOKE from PUBLIC/anon/authenticated and
  GRANT to service_role, plus the non-concurrent index `idx_wa_messages_member_queued`. Migration **081**
  `event_type_reachability_restored`: rewrites `events_type_check` with the same 19 types plus `reachability_restored`.
  Both are DDL only and change no data.
- **No new env vars.** The only new `process.env` read in the diff is `KAPSO_WEBHOOK_SECRET`, inside a test file. That var already
  exists in the site `.env` (checked by name only). Lockfile unchanged, so deploy.sh skipped `npm ci`.
- Target: `https://app.ohmyclient.io`, Forge server 1149990 / site 3123752, `forge@34.158.58.133`, checkout
  `/home/forge/app.ohmyclient.io` on `release`. Supabase prod = `whatsapp-crm-pro` (`uzimqndenngebzgndlhd`).
  SQL ran read-only through the Supabase Management API (`POST /v1/projects/<ref>/database/query`). The token was
  read from the box `.env` on the box and never printed.
- Previous prod: `main@4aa77522`, release `7884616`, BUILD_ID `3d4MGZIglesEHuevjn8cK`, pids 1085 / 1089
  (12 days uptime), migrations through 079.
- Executed from a fresh worktree, `/Users/xavierau/Code/js/whatsapp-crm-release-mem-001` (branch `release-mem-001` at
  `origin/main`), with `.env.local` and `.env.production.local` copied from the primary checkout. The dirty primary
  checkout and the dirty `whatsapp-crm--members-table` worktree were left untouched. Window: Wednesday 08:38–08:56Z
  (16:38–16:56 HKT). The orchestrator gave the go, relaying the owner's approval "release to prod" of 2026-10-07.

## Pre-Flight Checklist
- [x] **Local CI on the release tree (fresh `npm ci`, under the `heavy` lock)**: `tsc --noEmit` exit 0;
      `vitest run` → **543 files passed / 7 skipped; 5,722 tests passed, 46 skipped, 2 todo, 0 failed** (24.6 s).
      GitHub checks on #172: CodeRabbit only. No other CI is configured.
- [x] **Size gate for 080's non-concurrent index (08:40:25Z, read-only)**: `whatsapp_messages` **5,346 rows,
      7.0 MB** total (all 5,346 rows are outbound with a member_id). That is far below the ~1M rows / ~500 MB
      threshold, so the **in-migration path** was taken (no `CONCURRENTLY` pre-create; lock time ≈ ms). `events`: 8,876
      rows, 2.97 MB, so 081's CHECK validation is trivial.
- [x] **081 superset check**: the live `events_type_check` holds exactly the 19 types that 081 copies. Types in use:
      campaign, consent_imported, join, redeem, whatsapp_error. All are kept, so no row can fail validation.
- [x] **Backup (08:40–08:41Z, before any DB change). The gate passed, so later steps proceeded**:
      - Supabase managed physical backup **id 1887852771, COMPLETED, 2026-10-06T19:26:59Z** (7 dailies, WAL-G on,
        PITR off), saved as `managed-backups.json` (sha256 `cfe9efeb…`).
      - Pre-change catalog snapshot `baseline-catalog.json` (sha256 `ac1652e8…`): the `events_type_check` definition,
        `whatsapp_messages` index definitions, function absent (0), and migrations through 079.
      - Full-row export of `events`, the only table whose constraint changes: **8,876 rows, 3,214,220 B,
        sha256 `359e92c8c6a6eafc…`**, taken 08:41:05Z.
      - Location: box `/home/forge/backups/2026-10-07-mem-001-004/` (dir 700, files 600). The two catalog files
        are also in the session scratchpad `mem001/backup/`.
      - Code restore point: `origin/release` fetched as the local ref **`release-backup-7884616`** in the release
        worktree (not pushed).
- [x] **Box (08:38Z)**: disk 30,764 MB free (the disk is now 58 GB; it was 29 GB before). **RAM available 476–494 MB, swap 778 of
      1,023 MB used, si/so ≈ 0** (no thrashing). Top consumer: this app's own `next-server`, 1.55 GB RSS after
      12 days. Judgement: the build is off-box, the lockfile is unchanged (no `npm ci`), and the restart frees that RSS,
      so the deploy adds no memory peak. This was not treated as the escalate_if case. After deploy:
      **2,555 MB available**, swap free 410 MB.
- [x] **App baseline**: `/api/health` 200, `/login` 200, `/` 307; `/login` embeds `3d4MGZIglesEHuevjn8cK` once;
      daemons RUNNING 1085 / 1089.
- [x] Migrations reviewed: 080 is idempotent (CREATE OR REPLACE, IF NOT EXISTS) and 081 is idempotent (DROP IF EXISTS
      + ADD). Both are reversible (see Rollback). One-way risk: none.
- [x] Secrets: none added or changed. Redis untouched. DEV Supabase untouched.

## Runbook (as executed)
```
# 1. merge
gh pr merge 172 --merge --subject "Merge pull request #172 from xavierau/develop (release: MEM-001 … migrations 080+081)"
git ls-remote origin refs/heads/main                       # d73b7e2a… ✓ (08:41:15Z)
# 2-3. backup + size gate: Management API SQL from the box (helper reads token from site .env), see Pre-Flight
# 5. release from a fresh worktree (primary checkout is dirty: never stash/reset it)
git worktree add ../whatsapp-crm-release-mem-001 -b release-mem-001 origin/main
cp .env.local .env.production.local ../whatsapp-crm-release-mem-001/
rtk proxy git push -u origin release-mem-001 && git ls-remote --heads origin release-mem-001   # d73b7e2a ✓
git fetch origin refs/heads/release:refs/heads/release-backup-7884616                         # restore point
resource-lock.py heavy -- bash -c 'npm ci && npx tsc --noEmit && npx vitest run'               # green
SOURCE_REF=release-mem-001 resource-lock.py heavy -- bash scripts/release.sh                    # exit 0, 08:51:04Z
git ls-remote --heads origin release                       # 0071fa31… ✓ (was 7884616)
# 4. Forge auto-deploys `release`; deploy.sh runs `supabase db push --linked --include-all` (080, 081) BEFORE restart
rtk proxy git push origin --delete release-mem-001         # 08:54:27Z, ls-remote empty
```
release.sh tail:
```
→   building release-mem-001 @ d73b7e2
✓ Compiled successfully in 18.7s
✓ Generating static pages using 7 workers (84/84) in 797ms
→   BUILD_ID AkWQ9N80t9yjaXRQRWYWu
→ Scanning bundle for inlined credentials →   clean
 + 78846167...0071fa31 0071fa3114b1bbb4988f6eb92a62db8dd3de9de9 -> release (forced update)
✓ Released release-mem-001 @ d73b7e2 → origin/release (0071fa3)
release.sh exit=0
```
**Ordering note**: the brief listed "apply 080 + 081" before "release". On this site the migrations are applied
by Forge's deploy.sh (`supabase db push --linked --include-all`), which runs after the checkout sync and **before**
the daemon restart. This is the CAMP-012/013 precedent, and it records the migrations in
`supabase_migrations.schema_migrations`. Applying them by hand first would have bypassed that ledger. The net order the
brief cares about is still met: backup → migrations → new code serving. Old code tolerates both migrations (an
additive function/index and a wider CHECK).

## Deploy facts (Forge deployment 79568366, 2026-10-07 UTC)
| time | event |
|---|---|
| 08:46:47 | bundle built (`RELEASE.json.built_at`) |
| 08:51:04 | `release` force-pushed → `0071fa3` |
| 08:51:16 | Forge deployment 79568366 started |
| 08:51:45 | deploy.sh: disk 30,747 MB free; BUILD_ID check OK; lockfile unchanged, `npm ci` skipped; supabase CLI 2.98.2 |
| ~08:51:50 | `supabase db push`: `Applying migration 080_member_delivery_quality.sql... 081_event_type_reachability_restored.sql... Finished` |
| ~08:52:0x | app daemon 746791 → **pid 2130560** RUNNING; worker 801730 → **pid 2130632** RUNNING; `✓ Deploy complete` |
| 08:52:12 | deployment finished (status `finished`) |

## Post-Deploy Verification (read-only; ALL PASS)
| check | result |
|---|---|
| migration ledger | `079 active_members_rpcs`, **`080 member_delivery_quality`**, **`081 event_type_reachability_restored`** |
| function | `member_delivery_quality(uuid,uuid[],integer)`, `provolatile s`, not SECURITY DEFINER, ACL **`{postgres=X/postgres,service_role=X/postgres}`**: matches 080's REVOKE/GRANT |
| index | `idx_wa_messages_member_queued ON whatsapp_messages (member_id, queued_at) WHERE member_id IS NOT NULL AND direction = 'outbound'`, `indisvalid = true` |
| CHECK | `events_type_check` = the 19 previous types + **`reachability_restored`** (20), `convalidated = true` |
| data untouched | events 8,876, whatsapp_messages 5,346, members unreachable 224 (all = baseline); `reachability_restored` events 0 (none yet: the first one appears when an unreachable contact messages in) |
| RPC via PostgREST, service key (real wire path, from the box) | Kushiro (`96676002…`, 2,498 members): first page `limit=250` **206, 250 rows, content-range `0-249/2498`, 0.27 s**; RPC with those 250 ids **200, 250 rows, 0.24 s**, response headers 867 B (ids travel in the POST body, so there is no `.in()` header overflow); totals delivered 387 / read 16 / failed 80 / pending 6, 245 of 250 members have 90-day traffic, so the quality column has data to show |
| RPC tenant scoping | same 250 ids with another tenant's id (`1398d9a8…`) → **200, 0 rows** |
| RPC lockdown | anon key → **401 `42501 permission denied for function member_delivery_quality`** |
| RPC timing (`EXPLAIN ANALYZE`, 250 ids) | plan 0.67 ms / **exec 4.39 ms** |
| No-tag data | Kushiro has 4 members with zero tags (what `tagId=none` should return for that tenant) |
| provenance | RELEASE.json `source_commit d73b7e2a…`, `source_ref release-mem-001`, `build_id AkWQ9N80t9yjaXRQRWYWu`; HEAD `0071fa3`; only dirt ` M supabase/.temp/cli-latest` (pre-existing) |
| served build | `/login` embeds `AkWQ9N80t9yjaXRQRWYWu` once and the old `3d4MGZIglesEHuevjn8cK` zero times; a referenced `/_next/static/chunks/*.js` serves **200** (#56 failure mode absent) |
| feature in bundle | `.next/server` files referencing `member_delivery_quality`: 2; files carrying the quality strings: 114 |
| daemons | both RUNNING, pids **2130560 / 2130632** (were 1085 / 1089), uptime 0:02 at check, no restart loop |
| logs | worker: `Workers started: campaign, event-dispatch, receipt, email-send, integration-inbound, integration-outbound`, **0 lines after it** (no errors); app: `✓ Ready in 421ms`, 0 error lines since. Pre-existing and unrelated: `[Kapso] Error listing templates` (1,937 lines before this restart) |
| public | `/api/health` 200, `/login` 200, `/` 307, `/dashboard/members` 307 (auth redirect), `/api/dashboard/members?pageSize=250` **401** unauth, `?tagId=none` **401** unauth (route live and auth-gated) |
| authenticated UI smoke (AC-5) | **NOT RUN**: no pinned prod test account (see Outcome) |
| disk / RAM | 30,746 MB free (48%); MemAvailable 2,555 MB |

## Behaviour changes to expect
- Members table: a 20/50/100/250 page-size selector, First/Prev/Next/Last paging, a "No tag" filter, and a contact quality
  column. Unreachable members (131026, 190 at Kushiro) show Red.
- MEM-004: the next inbound message from any of the 224 currently unreachable members clears their `unreachable_at`
  and writes one `reachability_restored` event. **This is the first prod write path this release adds.**

## Rollback Procedure (ready, NOT executed; ETR ≈ 1–2 min for code; DB stays)
```
cd /Users/xavierau/Code/js/whatsapp-crm-release-mem-001
rtk proxy git push --force origin release-backup-7884616:refs/heads/release      # exact previous bundle = main@4aa77522
git ls-remote --heads origin release                                             # must read 7884616…
# Forge redeploys: RELEASE.json source_commit 4aa77522, both pids change, /api/health 200, worker "Workers started: …".
# deploy.sh's `db push` is a no-op (080/081 stay recorded).
```
Migrations stay: the function and index are unused by the old build, and the wider CHECK is harmless. If a DB revert is ever
demanded (surface it to the user first, never silently):
`DROP FUNCTION public.member_delivery_quality(uuid, uuid[], int); DROP INDEX IF EXISTS idx_wa_messages_member_queued;`
and, only if no `reachability_restored` rows exist yet, re-add the 19-type `events_type_check` from
`baseline-catalog.json`. After that, delete the 080/081 rows from `supabase_migrations.schema_migrations`, otherwise the next
deploy will not re-apply them.

## Observability
- Worker log `/home/forge/.forge/daemon-801730.log`; app log `/home/forge/.forge/daemon-746791.log`. Grep
  `reachability`, `member_delivery_quality`, `events_type_check` (must be 0 after 081).
- DB: `SELECT count(*) FROM events WHERE type='reachability_restored'` and `SELECT count(*) FROM members WHERE
  unreachable_at IS NOT NULL` (224 at release) show MEM-004 working over the coming days.
- RPC: 4.4 ms in-DB at 250 ids. Re-measure if `whatsapp_messages` grows by orders of magnitude.

## Cleanup (created vs deleted)
| item | created | deleted |
|---|---|---|
| remote branch `release-mem-001` | ~08:42Z | **yes** 08:54:27Z (`ls-remote` empty) |
| PR #172 | merged (`d73b7e2a`) | n/a |
| worktree `/Users/xavierau/Code/js/whatsapp-crm-release-mem-001` + local ref `release-backup-7884616` | yes | **kept** as the rollback handle until the release is accepted |
| `origin/release` `7884616` → `0071fa3` (orphan, force-pushed by design) | replaced | n/a |
| box `/home/forge/backups/2026-10-07-mem-001-004/` (3 files, ~3.2 MB) | yes | kept (restore point; delete once accepted) |
| prod rows | **none created, changed or deleted** (SQL read-only; PostgREST probes were reads) | residue 0 |

## Outcome
2026-10-07 08:38–08:56Z. Deployed `d73b7e2a` (release `0071fa3`, BUILD_ID `AkWQ9N80t9yjaXRQRWYWu`) to production.
Migrations 080 + 081 were applied by deploy.sh after the backup gate passed: managed backup 1887852771 plus an `events` export
and a catalog snapshot. The function is service_role-only and tenant-scoped, the index is valid, and the CHECK has 20 types.
Both daemons restarted with clean logs; health 200; the new build is served. Drift from the brief:
(1) migrations were applied by the deploy, not ahead of it (see Ordering note); (2) AC-5 was not run because no prod
test account exists. The owner should do a 2-minute manual check: open `/dashboard/members`, set 250/page, pick "No tag",
check the quality column, then open one member's detail. Alternatively, mint a pinned prod smoke account and record it in `ui-map/`.
