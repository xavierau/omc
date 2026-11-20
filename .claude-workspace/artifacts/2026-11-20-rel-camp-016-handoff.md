---
id: artifacts/2026-11-20-rel-camp-016-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-20
status: active
item: CAMP-016
state: done
brief: inline (main, CAMP-016 release brief-v1, base 3c3b553d)
base: 3c3b553d14266ca2aa51d3fe58e9e62dea4c5ea9
branch: docs/camp-016-release-records (records PR into develop, not merged)
pr: https://github.com/xavierau/omc/pull/202 (develop → main, merged 16:56:06Z, 188bf93a)
stage: poc
gate: {result: pass, at: 2026-11-19T16:51:15Z}
next: {owner: main, action: "merge the records PR into develop; owner tries Settings → Campaigns on a real tenant; delete the box backup dir once the release is accepted"}
blockers: []
refs: [deploys/2026-11-20-camp-016-release-runbook, artifacts/2026-11-19-dev-camp-016-r3-handoff, artifacts/2026-11-19-camp-016-plan, kanban:CAMP-016]
---
# REL-CAMP-016: CAMP-016 released to production

Prod serves `main@188bf93a`, release `b40e2e29`, BUILD_ID `nUUD8IZ3cKKd62nx1V0ws`, app pid 3321221, worker pid
3321288. Migration 086 was applied before the restart. Full record: `deploys/2026-11-20-camp-016-release-runbook`.
Evidence: `artifacts/evidence/2026-11-20-camp-016-release/`. All times UTC (2026-11-19 UTC = 2026-11-20 HKT).

## ac
- **AC-1: pass.** Release PR #202 (develop `3c3b553d` → main) MERGED 16:56:06Z, merge commit `188bf93a`;
  `git merge-base --is-ancestor 3c3b553d origin/main` true; main tree == develop tree `0f35c427`. CodeRabbit pass,
  MERGEABLE/CLEAN. Delta re-verified: under `supabase/` only `migrations/086_campaign_audience_quality.sql`; no
  package, scripts, deploy.sh or `.env.example` change.
- **AC-2: pass.**
  - Backup first (16:48:33Z, before the merge): managed physical backup **2306777673 COMPLETED
    2026-11-18T19:32:11Z** (newest; WAL-G on, PITR off), plus full row copies of the two tables 086 alters in
    `/home/forge/backups/2026-11-20-camp-016/` (700/600, sha256 in the runbook).
  - 086 applied by Forge deployment 83484463: `Applying migration 086_campaign_audience_quality.sql...` →
    `Finished supabase db push.` → restarts. Baseline ledger tail was 085, so exactly 086 was pending.
  - Checks at 17:00:40Z: the 4 columns exist with the specified types/defaults; tcs 7 rows (0 restaurants without
    one); `monthly_send_limit` 1000 × 6, 10000 × 1 before and after, and 7 of 7 rows match their backup copy with
    `red` / `30`; campaigns 46 of 46 pre-existing read `off` / NULL; the three functions EXECUTE anon false,
    authenticated false, service_role true (ACL has no PUBLIC); one `campaign_audience_members` signature (keyset).
- **AC-3: pass.** `ls-remote release` = `b40e2e29` (was `79c2634f`); box `RELEASE.json` source_commit `188bf93a`,
  build_id == `.next/BUILD_ID` `nUUD8IZ3cKKd62nx1V0ws`; `/login` serves it once and the old one 0 times; pids app
  3267575 → 3321221, worker 3267616 → 3321288; `✓ Ready in 1809ms`, `Workers started: … agent-reply`. Error lines:
  see AC-4.
- **AC-4: pass.** (`ac-smoke.log`, `rpc-smoke-and-box.log`, `box-stability.log`)
  - `/dashboard/setup/campaigns`, `/dashboard/setup/welcome` 307 → /login; no 5xx. `/api/health` 200.
  - `GET /api/dashboard/settings/campaigns` 401; also `…/quality` 401 and `POST …/campaigns/audience-count` 401.
  - `campaign_audience_counts` via PostgREST with the service-role key, largest tenant (id withheld): audience
    2,519 == its 2,519 active members; lapsed 30 + skip red → will_receive 2,151 ≤ 2,519; HTTP 200. Anon key → 401
    `42501 permission denied`.
  - 10-minute log window: see `box-stability.log` and the runbook's verification section. The app's only error-ish
    line is the pre-existing `[Kapso] Error listing templates: WhatsApp configuration not found` warn (9,121 earlier
    occurrences, 18 in the BOOK-004 run; CAMP-016 does not touch that client).
- **AC-5: pass.** `deploys/2026-11-20-camp-016-release-runbook` (pre-flight, executed runbook, deploy facts, 086
  before/after, smoke, rollback with previous release `79c2634f` / BUILD_ID `3swaJrxsFle8BXKvCxYCZ` and the 086
  down-steps). poc-log: CAMP-016 lines' outcomes filled + a release line. Kanban CAMP-016 review → done. On
  `docs/camp-016-release-records`, PR into develop.

## unverified
- No authenticated UI walk on prod and no campaign send (brief: read-only smoke). The first owner visit to
  Settings → Campaigns and the first campaign created with the filters are the first live runs of the form, the
  snapshot write and the keyset send path through real PostgREST.
- Send performance at scale: each keyset page rates the whole audience before filtering (r3 handoff). The count RPC
  on 2,519 members took 183–492 ms; a full send walk was not measured.
- The newest managed backup is ~21 h older than the migration; row copies of both altered tables bridge that gap
  for this migration's columns only.

## notes
- `gh pr merge 202` was allowed this time (AGENT-003's equivalent was denied); no blocked hand-back was needed.
- Forge's site-commands POST answered 202 with an empty body; the helper falls back to the newest command id.
- The first RPC smoke run compared against a members read capped by PostgREST max-rows (903); rerun with
  `count=exact`. Both runs are in the evidence, annotated.
- Box helper dir `/home/forge/rel-camp016-tmp/` held only scripts and SQL (secrets read from `.env` in memory).
