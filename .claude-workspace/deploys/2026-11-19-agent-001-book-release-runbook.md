---
id: deploys/2026-11-19-agent-001-book-release-runbook
type: deploy
author: dev
created: 2026-11-19
status: executed
supersedes: null
superseded_by: null
related: [kanban:AGENT-001, github:185, github:187, github:188, github:189, artifacts/2026-11-19-rel-agent-book-handoff, deploys/2026-11-12-book-001-release-runbook, deploys/2026-11-05-camp-014-release-runbook, deploys/2026-10-07-mem-001-004-release-runbook]
---

# Deploy: AGENT-001 AI reply agent: `main` @ `091b36b` to production

**Outcome: DEPLOYED 2026-11-19 03:51Z. Migration 083 applied. Every read-only smoke check PASSES. The live
Gemini probe with the prod key returns 200.** Prod serves `main@091b36ba`, release **`55995fa2`**, BUILD_ID
**`iOPJoRj0NXfsHDLCC1TO3`**. App pid **3027483**, worker pid **3027518**; the worker started `agent-reply` and the
hourly purge scheduler fired once at boot. Every restaurant ships with `agent_config.mode = off`.

**omc → shadow: DONE. omc (`2e578557-…`, OhMyClient) reads `agent_config = {"mode":"shadow","rev":1}` at the
06:42:50Z read-back (write 06:42:49Z, 1 row); the other 6 restaurants stay mode off.** Shadow stores drafts and still
sends the fallback menu, so diners see no change.

Stage: POC (the repo does not import `stages/mature.md`). Hosting: the existing Forge box. The `fly-deploy` and
Cloudflare rules do not apply. Go: Xavier, 2026-11-19 ("1y" release, "2y" omc shadow), relayed by main.

## Scope
- **BOOK-001/002 were already on prod** before this run: releases `034998b`, `397bc64`, `25532d9`
  (`deploys/2026-11-12-book-001-release-runbook`, Releases 1–3), migration 082 and Forge jobs 2216322/2216323 included.
  `origin/main..origin/develop` held only **`4509413c`** (AGENT-001, PR #185), so this release ships AGENT-001 alone.
- PR **#185** squash `4509413c`: the reply agent (webhook hook, `agent-reply` BullMQ worker, Gemini adapter,
  read-only tools, hourly retention purge, `/dashboard/setup` agent settings, `/dashboard/agent` conversation log,
  `GET/PUT /api/dashboard/settings/agent`, `GET /api/dashboard/agent/conversations[/threadKey]`). Migration **083_agent_reply**.
- Release PR **#187** (develop `4509413c` → main): MERGEABLE/CLEAN, no conflict resolution needed (`git merge-tree`
  exit 0; the merged tree's `src supabase scripts package* deploy.sh` equal develop's). Merge commit **`43f9fc5d`**
  at 03:29:44Z.
- **Bundle blocker and fix.** The first `release.sh` run (03:36Z) built `azgqBpgZTEZZ7hqw4vGsC` and then refused to
  push: `log files in the bundle`. #185 committed 23 `*.log` evidence files under
  `.claude-workspace/artifacts/2026-11-19-agent-001-{w2,fix1}-evidence/`, and the gate assumes the repo tracks no
  `*.log`. Nothing was pushed. Fix without touching `scripts/` or renaming cited evidence:
  - PR **#188** (`chore/release-evidence-log-export-ignore` → develop, squash **`1e2e8817`**): adds
    `.claude-workspace/.gitattributes` = `*.log export-ignore`. `git archive` omits them (0 `.log` in the archive);
    they stay tracked. Workspace-only, CodeRabbit pass (skipped for base), low-risk merge per the standing rule.
  - Release PR **#189** (develop `1e2e8817` → main): CLEAN, merge commit **`091b36ba6f3ca34df80d68d5bc3ca81aeac67461`**
    at ~03:47Z. Diff vs `43f9fc5d`: only `.claude-workspace/.gitattributes`.
- `package.json` and the lockfile are unchanged against the previous prod, so deploy.sh skipped `npm ci`. No
  `src/app/api/cron` or `scripts/cron` change since prod `cf8b4aa6`: **no new Forge Scheduled Job needed**.
- New env: `AGENT_MODEL` (optional; empty → `gemini-3.8-flash`). `GEMINI_API_KEY` already set (BOOK-001 r1).
- Target: `https://app.ohmyclient.io`, Forge server 1149990 / site 3123752 (`forge@34.158.58.133`), checkout
  `/home/forge/app.ohmyclient.io` on `release`. Supabase prod `whatsapp-crm-pro` (`uzimqndenngebzgndlhd`).
- Previous prod: `main@cf8b4aa6`, release **`25532d94`**, BUILD_ID `aVfHeC7nQOiLbXFbj4ZO_`, pids 3893176 / 3893239.
- Executed from a fresh detached worktree `/Users/xavierau/Code/js/whatsapp-crm--release-agent001` (from
  `origin/develop`), `.env.local` and `.env.production.local` copied in (byte-identical, gitignored, never committed).
  The primary checkout and the other worktrees were not touched.

## Pre-Flight
- [x] **Gate** on develop tip `4509413c` under the heavy lock, fresh `npm ci` (exit 0): `tsc --noEmit` exit 0;
      `vitest run` exit 0, **633 files passed / 10 skipped, 7,059 tests passed, 66 skipped, 2 todo**. Exit codes read
      from files. The released tree differs from it only by `.claude-workspace/` docs and the `.gitattributes`.
- [x] **Backup (03:26Z, before any DB change; gate passed).** Managed physical backup **2306777673 COMPLETED
      2026-11-18T19:32:11Z** (7 dailies, WAL-G on, PITR off). Box `/home/forge/backups/2026-11-19-agent-001/`
      (700, files 600):
      - `managed-backups.json` (sha256 `f9e37b6e…`);
      - `restaurants.json`, full-row export, 7 rows (sha256 `60cb9c52…`): the only table 083 alters;
      - `baseline-catalog.json` (sha256 `4e175fab…`): ledger 079–**082**, `agent_config` absent, `agent_messages` /
        `agent_silences` absent, no `restaurants_agent_config_mode_check`, restaurants 7 / members 4,225 / campaigns 46.
- [x] **Env, by name only.** `GEMINI_API_KEY` set (len 53), `AGENT_MODEL` absent (fine), `CRON_SECRET` set,
      `APP_URL` set, `SUPABASE_ACCESS_TOKEN` set, `REDIS_URL` set.
- [x] **Box (03:25Z).** Disk 27,530 MB free. MemAvailable 1,417 MB. **Swap 1,021 / 1,023 MB used** but idle
      (`vmstat 2 4`: si/so 0 after the first sample), load 0.16. Judged not "pinned" in the escalate sense: the build
      is off-box and the lockfile is unchanged (no `npm ci`), the BOOK-001 precedent (658 MB available, same swap).
      Top RSS: this app's next-server 801 MB after 6 days, freed by the restart.
- [x] **Restore point.** `origin/release` (`25532d94`) fetched as the local ref **`release-backup-25532d9`** (not pushed).
- [x] **omc lookup (read-only).** Restaurants matching omc/OhMyClient: exactly one,
      `2e578557-e903-4b1d-877e-598b43956c39` "OhMyClient" slug `oh-my-client` (active). "Golden Wave" has slug
      `oh-my-agent` and is not a match.

## Runbook (as executed, UTC)
```
cd /Users/xavierau/Code/js/whatsapp-crm
rtk proxy git worktree add --detach ../whatsapp-crm--release-agent001 origin/develop   # 4509413c
cp .env.local .env.production.local ../whatsapp-crm--release-agent001/
cd ../whatsapp-crm--release-agent001
resource-lock.py heavy -- bash -c 'npm ci; npx tsc --noEmit; npx vitest run'           # all exit 0
# backup + catalog: Management API from the box (token read from the site .env on the box)
gh pr create --base main --head develop; gh pr merge 187 --merge --match-head-commit 4509413c…   # 43f9fc5d
rtk proxy git fetch origin refs/heads/release:refs/heads/release-backup-25532d9
rtk proxy git checkout -B rel-agent001 origin/main; rtk proxy git push origin rel-agent001
SOURCE_REF=rel-agent001 resource-lock.py heavy -- bash scripts/release.sh   # exit 1: 23 *.log in bundle, nothing pushed
# fix: .claude-workspace/.gitattributes '*.log export-ignore'
gh pr create --base develop …; gh pr merge 188 --squash --match-head-commit aedeb68d…            # 1e2e8817
gh pr create --base main --head develop; gh pr merge 189 --merge --match-head-commit 1e2e8817…   # 091b36ba
rtk proxy git checkout -B rel-agent001 origin/main
rtk proxy git push --force-with-lease=rel-agent001:43f9fc5d origin rel-agent001                   # 091b36ba ✓
SOURCE_REF=rel-agent001 resource-lock.py heavy -- bash scripts/release.sh   # exit 0
git ls-remote origin refs/heads/release                                     # 55995fa2 ✓ (was 25532d94)
# Forge auto-deploy of `release`: deploy.sh → supabase db push (083) → seed → restart app + worker
rtk proxy git push origin --delete rel-agent001                             # r1 recorded "ls-remote empty"; NOT true, see Cleanup
```
release.sh tail:
```
→   BUILD_ID iOPJoRj0NXfsHDLCC1TO3
→ Scanning bundle for inlined credentials →   clean
 + 25532d94...55995fa2 55995fa28d21efcff85e0ab7809caf0528693f34 -> release (forced update)
✓ Released rel-agent001 @ 091b36b → origin/release (55995fa)
```
**Migration ordering.** As in MEM-001/004 and BOOK-001, 083 is applied by deploy.sh's
`supabase db push --linked --include-all`, which runs under `set -euo pipefail` after the checkout sync and
**before** both daemon restarts, and records the ledger row. A failed push stops the deploy with the old code still
serving. Old code ignores the new column and tables, so the order backup → 083 → new code serving holds.

## Deploy facts
| time (UTC) | event |
|---|---|
| 03:49:26 | bundle built on the Mac (`RELEASE.json.built_at`, node v22.21.1) |
| 03:50:57 | `release` force-pushed → `55995fa2` |
| ≤03:51:31 | box checkout at `55995fa2`, `.next/BUILD_ID` = `iOPJoRj0NXfsHDLCC1TO3` |
| ~03:51:50 | app daemon-746791 → **pid 3027483** (next-server), worker daemon-801730 → **pid 3027518** |
| 03:51:56 | worker: `[AgentReplyQueue] Worker started`, `Workers started: … integration-outbound, agent-reply`, then `agent.purged {deleted:0, silences:0, failedTenants:0}` |

## Migration 083 result (read-only, Management API from the box, 03:52Z)
| check | result |
|---|---|
| ledger | `081`, `082`, **`083`** |
| `restaurants.agent_config` | `jsonb NOT NULL DEFAULT '{"mode": "off"}'`; all **7 of 7** restaurants `off` |
| CHECK | `restaurants_agent_config_mode_check`: object and mode in (off, shadow, auto) |
| tables | `agent_messages`, `agent_silences`: RLS **on**, **0 policies**, 0 rows each |
| indexes | `agent_messages_{pkey, one_reply_key, restaurant_wamid_key, conversation_idx, restaurant_created_idx}`, `agent_silences_{pkey, until_idx}` |
| grants | anon/authenticated hold Supabase's default table grants (as for 082's tables); with RLS on and no policy the anon key reads **`[]` HTTP 200** from both tables via PostgREST |
| row counts | restaurants 7, members 4,225, campaigns 46: unchanged from the 03:26Z baseline |

## Post-Deploy Verification (read-only, unauthenticated, no data created; ALL PASS)
| check | result |
|---|---|
| provenance | RELEASE.json `source_commit 091b36ba…` == main tip, `source_ref rel-agent001`, `build_id iOPJoRj0NXfsHDLCC1TO3` == `.next/BUILD_ID`; HEAD `55995fa2`. Only dirt ` M supabase/.temp/cli-latest` (pre-existing) |
| served build | `/login` embeds the new BUILD_ID once and the old one 0 times; chunk `/_next/static/chunks/1edfvwc5_eck-.js` **200** |
| new routes | `GET /api/dashboard/settings/agent` **401** `{"error":"Unauthorized"}`, `PUT` **401**, `GET /api/dashboard/agent/conversations` **401**, `…/conversations/x` **401**, `/dashboard/agent` 307 (auth redirect) |
| existing | `/api/health` 200, `/login` 200, `/` 307; `/api/cron/booking-reminders` and `-retention` 401 without bearer |
| cron | no new cron route. Job 2216322 ticks (03:50:01Z `{"candidates":0,…}`), 2216323 last ran 03:30:02Z `{"purged":0,…}` |
| stability | at 03:54:02Z both pids alive (2:17 / 2:14 elapsed), one next-server, no restart |
| logs | worker: 1 line after the start banner (`agent.purged`), no `retention scheduler not registered`. App: `✓ Ready in 652ms` + the known standalone warning; 0 fatal/uncaught/unhandled/missing-module/Redis-error lines |
| box after | MemAvailable 2,305 MB, swap free 132 MB, load 0.56, disk 27,504 MB free |
| not run | authenticated UI, any tenant login, any send |

## Live model probe (AC-LIVE)
From the box, prod `GEMINI_API_KEY` (sent as `x-goog-api-key` from a 600 temp file, deleted), `v1beta`
`gemini-3.8-flash:generateContent`, canned prompt with no diner data ("what time does a typical Hong Kong cafe
open?"), `thinkingLevel low`, `maxOutputTokens 400`: **03:53:46Z try 1 HTTP 200**, finishReason STOP,
modelVersion `gemini-3.8-flash`, 17 prompt / 32 output tokens, text returned. A 200 does **not** show the key's
billing tier (OR1).

## omc → shadow (r2, 2026-11-19 06:41–06:43Z)
Go: Xavier "2y" 2026-11-19; OR1 confirmed ("we have production credentials": the prod Gemini key is a separate paid
key). Executed by a cold r2 agent after r1 died mid-cleanup. All SQL via the Supabase Management API
(`POST /v1/projects/uzimqndenngebzgndlhd/database/query`) from the box, `SUPABASE_ACCESS_TOKEN` read from the site
`.env` on the box, never printed. Results in `/home/forge/backups/2026-11-19-agent-001/` (700, files 600).

| step | result |
|---|---|
| box before (06:41:37Z) | app pid **3027483**, worker pid **3027518**, both alive since 03:51Z (2:49:52 elapsed), unchanged since r1 |
| worker log since 03:51:56Z | 5 lines: the start banner, `Workers started: … agent-reply`, and `agent.purged {deleted:0, silences:0, failedTenants:0}` at 03:51, 04:51, 05:51Z. No error or warn line |
| GET-before (06:42:09Z) | `omc-agent-config-before.json` (sha256 `9190a9a8f84498f5…`): 7 restaurants, every one `{"mode": "off"}`; exactly one `oh-my-client` row, `2e578557-e903-4b1d-877e-598b43956c39` |
| first UPDATE try (06:42:31Z) | HTTP 400 `42601 syntax error`: shell quoting stripped the JSON literal. Nothing written (read-back at 06:42:32Z: all 7 still off). Re-sent with the SQL in a file |
| UPDATE (06:42:49Z) | `omc-agent-config-update.json`: CAS on the expected old value, **1 row** returned, `{"rev":1,"mode":"shadow"}` |
| read-back (06:42:50Z) | `omc-agent-config-after.json`: `oh-my-client` `{"rev": 1, "mode": "shadow"}`; bicho, oh-my-agent (Golden Wave), wall-street-bar-lounge, thai-ox, kushiro, cheung-ying-hong `{"mode": "off"}` |
| box after (06:42:59Z) | same two pids, worker log still 5 lines with no error, `/api/health` 200 |

```sql
-- applied (CAS: writes only if omc is still exactly {"mode":"off"})
UPDATE restaurants SET agent_config = '{"mode":"shadow","rev":1}'::jsonb
WHERE id = '2e578557-e903-4b1d-877e-598b43956c39' AND agent_config = '{"mode":"off"}'::jsonb
RETURNING id, slug, agent_config, now() AS written_at;
```
`rev: 1` is what the app's own settings PUT stamps on a config with no rev (`agent-config-repository.ts`
`writeIfUnchanged`), so the dashboard form loads it as rev 1 and its next save CAS-checks against 1.

Not checked: an inbound omc message producing a shadow draft (none was sent; no tenant login, no send). The first real
unmatched text to omc's number is the first live run of the shadow path: check `agent_messages` for omc rows and the
worker log for `agent-reply` lines after it.

## Rollback (ready, NOT executed; ETR ≈ 1–2 min)
1. **Agent off for omc only** (no redeploy), Management API SQL, CAS-safe:
   ```sql
   UPDATE restaurants SET agent_config = jsonb_set(jsonb_set(agent_config, '{mode}', '"off"'), '{rev}', to_jsonb(COALESCE((agent_config->>'rev')::int, 0) + 1)) WHERE id = '2e578557-e903-4b1d-877e-598b43956c39';
   ```
   Or Settings → AI agent → Off in the dashboard as an omc admin. Mode off sends every unmatched text to the
   fallback menu, as before this release.
2. **Code** to Release 3 of BOOK-002 (`25532d94` = `main@cf8b4aa6`, BUILD_ID `aVfHeC7nQOiLbXFbj4ZO_`):
   ```
   cd /Users/xavierau/Code/js/whatsapp-crm       # local refs are shared by every worktree of this repo
   rtk proxy git push --force origin release-backup-25532d9:refs/heads/release
   git ls-remote origin refs/heads/release       # must read 25532d94d5c2baf04c941d9f3276a28c10391b66
   # Forge redeploys: RELEASE.json source_commit cf8b4aa6, both pids change, /api/health 200,
   # /api/dashboard/settings/agent back to 404, worker banner without agent-reply.
   ```
   If the local ref is gone, force-push by SHA `25532d94d5c2baf04c941d9f3276a28c10391b66`.
3. **083 is additive and stays.** Old code ignores `agent_config` and the two tables. Queued `agent-reply` jobs and
   the purge scheduler stay in Redis with no worker; harmless. A DB revert is a separate owner decision (drop the two
   tables and the CHECK and column, delete the `083` ledger row; `restaurants.json` on the box is the row copy).
4. Booking jobs 2216322/2216323 stay: Release 3 serves both routes.

## Cleanup
| item | state |
|---|---|
| remote `rel-agent001` | **deleted by r2** at 06:41Z: r1 had recorded it deleted, but `ls-remote` still showed it at `091b36ba` when r2 started; after r2's `git push origin --delete rel-agent001`, `ls-remote origin refs/heads/rel-agent001` is empty |
| remote `chore/release-evidence-log-export-ignore` | kept (merged as #188) |
| local ref `release-backup-25532d9` | kept as the rollback handle |
| `origin/release` `25532d94` → `55995fa2` | replaced (force-push by design) |
| worktree `--release-agent001` | kept until the docs PR is pushed; remove afterwards |
| box `/home/forge/backups/2026-11-19-agent-001/` | kept (now also the three `omc-agent-config-*.json` files); delete once the release is accepted |
| worktree `--agent-001` (`feature/agent-001-ai-reply`) | **kept**: `wt-finish` (no `--force`) refused, exit 1: `feature/agent-001-ai-reply has 35 commit(s) not in main` (PR #185 was squash-merged, so the branch's own commits are never ancestors of main). Nothing removed; removal is main's call |
