---
id: deploys/2026-11-19-agent-003-release-runbook
type: deploy
author: dev
created: 2026-11-19
status: executed
supersedes: null
superseded_by: null
related: [kanban:AGENT-003, github:195, github:197, artifacts/2026-11-19-rel-agent003-handoff, artifacts/2026-11-19-agent-003-fix2-handoff, threats/2026-11-19-agent-003-agent-booking, deploys/2026-11-19-book-003-release-runbook, deploys/2026-11-19-agent-001-book-release-runbook]
---

# Deploy: AGENT-003 agent booking changes: `main` @ `f7ab94d` to production

**Outcome: DEPLOYED 2026-11-19 13:18Z. Migration 085 was applied before the daemons restarted. omc is configured for
booking. Every read-only smoke check passes.** Prod serves `main@f7ab94d6`, release **`fdc9cbe8`**, BUILD_ID
**`caIeIeX7IH0Qzhqp5AyPG`**. App pid **3237666** (next-server), worker pid **3237725**; the worker started
`agent-reply`. omc's `agent_config` is now rev **9**: the 7 booking tools are ticked, `fallbackModel` is
`gemini-3.1-flash-lite` and `maxOutputTokens` is 1024. Every other key is unchanged, including mode `auto`.

Stage: POC (the repo does not import `stages/mature.md`). Hosting: the existing Forge box; the `fly-deploy` and
Cloudflare rules do not apply. Go: Xavier, 2026-11-19 ("go ahead and release after the review"), relayed by main.
The re-review is APPROVED. Repo `xavierau/omc` is **public**; nothing below carries message text, phone numbers or
secrets (R8).

## Scope
- `origin/main..origin/develop` before this run: **`49a3f582`** (BOOK-003 release docs, #194) and **`7af9494b`**
  (AGENT-003, PR #195 squash).
  - PR #195: booking tools `list_my_bookings`, `propose_booking` / `create_booking_request`,
    `propose_booking_change` / `confirm_booking_change` and `propose_booking_cancel` / `confirm_booking_cancel`.
  - It also adds the model fallback (R18), handoff to staff on failure (R19), and the staff change-request confirm.
  - Migration **085_agent_booking_changes** (additive).
- Release PR **#197** (develop `7af9494b` → main): `git merge-tree` exit 0, merged tree == develop; MERGEABLE/CLEAN,
  CodeRabbit pass.
  - The dev's `gh pr merge` was **denied by the permission system** (13:07Z). It was not retried, and the run
    stopped as blocked.
  - Main merged #197 at **13:13Z** under Xavier's release approval. Merge commit
    **`f7ab94d6462dddb5e20c57d045ffe1eb262589d1`**, code tree equal to `7af9494b`.
- Not touched: package.json, lockfile, deploy.sh and `scripts/`, so deploy.sh skipped `npm ci` on the box. No cron
  route changed, so no new Forge Scheduled Job is needed.
- Env, by name only: `GEMINI_API_KEY` set. `AGENT_FALLBACK_MODEL` and `AGENT_MODEL` absent (fine: omc's
  `fallbackModel` and `model` win). No env var added or changed.
- Target: `https://app.ohmyclient.io`, Forge server 1149990 / site 3123752 (`forge@34.158.58.133`), checkout
  `/home/forge/app.ohmyclient.io` on `release`. Supabase prod `whatsapp-crm-pro` (`uzimqndenngebzgndlhd`).
- Previous prod: `main@45a10231`, release **`da99e4d4`**, BUILD_ID `4VXrhhE4uWnAnm-o-34bu`, pids 3129673 / 3129734.
- Executed from a fresh detached worktree `/Users/xavierau/Code/js/whatsapp-crm--release-agent003` (at `7af9494b`).
  `.env.local` and `.env.production.local` were copied in (byte-identical, gitignored, never committed). The primary
  checkout and `--agent-003` were not touched.

## Pre-Flight
- [x] **Gate** on `7af9494b` under the heavy lock, 13:03:52–13:04:53Z.
  - `npm ci` exit 0: the lockfile is unchanged, but the fresh tree had no `node_modules`.
  - `tsc --noEmit` exit 0.
  - `vitest run` exit 0: **648 files passed / 13 skipped, 7,348 tests passed, 94 skipped, 2 todo**.
  - Exit codes were read from files: `artifacts/evidence/2026-11-19-agent-003-release/ac-gate-*`.
  - The released tree (`f7ab94d6`) has the same code tree as `7af9494b`.
- [x] **Backup (13:04:42Z), before the develop → main merge.** Managed physical backup **2306777673 COMPLETED
      2026-11-18T19:32:11Z** (7 dailies, WAL-G on, PITR off). Box `/home/forge/backups/2026-11-19-agent-003/`
      (700, files 600):
      | file | content | sha256 |
      |---|---|---|
      | `managed-backups.json` | backup list | `f9e37b6ef0a2f4bf397e311bc559e0de0da005197494fca66598107cb08918c1` |
      | `restaurants.json` | full rows, 7 | `aa2fcda76ba155e257ae8ca93d85b3e8a70b97dd39f40efed7679abf39896cc0` |
      | `booking_requests.json` | full rows, 2 | `32fa2e1cd0ae0638d9fb1235f7816b97592fcf7ec17929c46944bcf5acc3e83c` |
      | `agent_messages.json` | full rows, 20 (085 rewrites its outcome CHECK and reply index) | `f1f368a309547dfe72b1e7f749e88d9f9aaf5bbd531817c48e0ce97466a0a577` |
      | `baseline-catalog.json` | catalog | `43e87c0f07a495619f4b0175221f2b13fb018265c4eb1088d860b010686701e8` |
      Baseline catalog:
      - Ledger tail 080–**084**, no 085.
      - `booking_requests` has none of `replaces_booking_id` / `cancelled_by` / `cancelled_at`, and its status
        CHECK lacks `cancelled`.
      - `confirm_booking_change` and `booking_requests_one_pending_change_idx` are absent.
      - Counts: restaurants 7, booking_requests 2 (1 confirmed, 1 pending), agent_messages 20, members 4,227.
- [x] **Box (13:04Z).** Disk 27,411 MB free, MemAvailable 2,329 MB. Swap had 9 MB free but was idle (`vmstat` si/so 0
      after the first sample), load 0.20. Not pinned, as in the AGENT-001 precedent; the build is off-box and
      `npm ci` was skipped.
- [x] **Restore point.** `origin/release` (`da99e4d4`) fetched as the local ref **`release-backup-da99e4d`** (not
      pushed).

## Runbook (as executed, UTC)
```
cd /Users/xavierau/Code/js/whatsapp-crm
rtk proxy git worktree add --detach ../whatsapp-crm--release-agent003 7af9494b
cp .env.local .env.production.local ../whatsapp-crm--release-agent003/
cd ../whatsapp-crm--release-agent003
resource-lock.py heavy -- bash -c 'npm ci; npx tsc --noEmit; npx vitest run'            # all exit 0
# backup + catalog: Management API from the box (helper reads the token from the site .env; never printed)
rtk proxy git merge-tree --write-tree origin/main origin/develop                       # exit 0, tree == develop
gh pr create --base main --head develop                                                # #197, CLEAN
gh pr merge 197 --merge --match-head-commit 7af9494b…                                  # DENIED (permission system) → blocked
# main merged #197 at 13:13Z → f7ab94d6
rtk proxy git fetch origin refs/heads/release:refs/heads/release-backup-da99e4d
rtk proxy git checkout -B rel-agent003 f7ab94d6; rtk proxy git push -u origin rel-agent003      # ls-remote f7ab94d6 ✓
SOURCE_REF=rel-agent003 resource-lock.py heavy -- bash scripts/release.sh               # exit 0, 13:14:32–13:17:25Z
git ls-remote origin refs/heads/release                                                 # fdc9cbe8 ✓ (was da99e4d4)
# Forge auto-deploy 83458453: deploy.sh → supabase db push (085) → seed → restart app + worker
rtk proxy git push origin --delete rel-agent003                                         # ls-remote empty ✓
```
release.sh tail (`artifacts/evidence/2026-11-19-agent-003-release/release-sh.log`):
```
→   BUILD_ID caIeIeX7IH0Qzhqp5AyPG
→ Scanning bundle for inlined credentials →   clean
 + da99e4d4...fdc9cbe8 fdc9cbe8ace40deff90e7fe32d99e559583dac91 -> release (forced update)
✓ Released rel-agent003 @ f7ab94d → origin/release (fdc9cbe)
```
No bundle-gate fix was needed: the 42 new `*.log` evidence files are all under `.claude-workspace/`, which the
existing `*.log export-ignore` covers.

**Migration ordering, proven from the Forge deployment log** (`GET …/deployments/83458453/log`, redacted copy in
`artifacts/evidence/2026-11-19-agent-003-release/forge-deploy-83458453.log`):
```
Thu Nov 19 13:17:50 UTC 2026
…
→ Applying pending migrations
 • 085_agent_booking_changes.sql
Applying migration 085_agent_booking_changes.sql...
Finished supabase db push.
→ Seeding platform admin (idempotent)
→ Restarting daemons
  restarting app → daemon-746791 … app is RUNNING
  restarting worker → daemon-801730 … worker is RUNNING
✓ Deploy complete
```
deploy.sh runs under `set -euo pipefail`, so `Finished supabase db push` comes before both restarts. The new app
process started at 13:18:10Z and the worker at 13:18:14Z, inside the deployment window 13:17:25–13:18:16Z.

## Deploy facts
| time (UTC) | event |
|---|---|
| 13:13 | main merge commit `f7ab94d6` (PR #197, merged by main) |
| 13:16:36 | bundle built on the Mac (`RELEASE.json.built_at`, node v22.21.1) |
| 13:17:25 | `release` force-pushed → `fdc9cbe8`; Forge deployment 83458453 starts |
| 13:17:50 | deploy.sh starts; checkout already at `fdc9cbe`; 27,316 MB free; lockfile unchanged, `npm ci` skipped |
| 13:17:50–13:18:10 | `supabase db push`: **085 applied**, `Finished supabase db push.` |
| 13:18:10 | app daemon-746791 → **next-server 3237666** (`✓ Ready in 487ms`) |
| 13:18:14 | worker daemon-801730 → **pid 3237725**; `Workers started: campaign, event-dispatch, receipt, email-send, integration-inbound, integration-outbound, agent-reply` |
| 13:18:16 | Forge deployment 83458453 finished |
| 13:18:15 | box `RELEASE.json`: source_ref `rel-agent003`, source_commit `f7ab94d6…`, build_id `caIeIeX7IH0Qzhqp5AyPG` == `.next/BUILD_ID`; only dirt ` M supabase/.temp/cli-latest` (pre-existing) |

## Migration 085 result (read-only, Management API from the box, 13:19:15Z)
| check | result |
|---|---|
| ledger | `081`…`084`, **`085` (agent_booking_changes)** |
| new columns | `replaces_booking_id` uuid, `cancelled_by` text, `cancelled_at` timestamptz |
| status CHECK | `status IN ('unverified','pending','confirmed','declined','cancelled')` |
| decision constraint | `(unverified/pending AND decided_at NULL) OR (confirmed/declined AND decided_at NOT NULL) OR (cancelled AND cancelled_at NOT NULL)` |
| cancel marker | `booking_requests_cancel_marker`: `(status = 'cancelled') = (cancelled_by IS NOT NULL)` |
| agent_messages | outcome CHECK adds `handoff`; `agent_messages_one_reply_key` partial on sent/shadow_draft/fallback/handoff |
| new index | `booking_requests_one_pending_change_idx` (unique, `replaces_booking_id` where pending) |
| function | `confirm_booking_change(uuid,uuid,uuid,timestamptz)` exists; EXECUTE anon **false**, authenticated **false**, service_role true |
| row counts | restaurants 7, booking_requests **2** (1 confirmed, 1 pending), agent_messages 20, members 4,227: **unchanged** from the 13:04Z baseline |
Box files: `after-catalog.json` (sha256 `e843ad00ef6ea243…`), `after-extra.json` (`6e2360877f66f844…`), both 600.

## omc agent config (13:19:43–13:19:50Z)
omc = `2e578557-e903-4b1d-877e-598b43956c39`, slug `oh-my-client`. All SQL went through the Management API from the
box. The results are in the box backup dir (600):
- `omc-agent-config-before.json`, sha256 `713d38716b6b83ab…`, read at 13:19:43Z: rev **8**, mode `auto`.
- `omc-agent-config-update.json`, sha256 `1fb5912d89e07564…`.
- `omc-agent-config-after.json`, sha256 `5ef6901a1a7c6cac…`.

One CAS write keyed on the read rev. It **merges** into the stored object, so no key is replaced or dropped:
```sql
UPDATE restaurants SET agent_config = agent_config || jsonb_build_object(
    'maxOutputTokens', 1024,
    'fallbackModel', 'gemini-3.1-flash-lite',
    'enabledTools', COALESCE(agent_config->'enabledTools','[]'::jsonb) || (<the 7 booking tools not already present, in order>),
    'rev', (agent_config->>'rev')::int + 1)
WHERE id = '2e578557-e903-4b1d-877e-598b43956c39' AND agent_config->>'rev' = '8'
RETURNING …;   -- 1 row, written_at 13:19:50.965Z
```
| key | before (rev 8) | after (rev 9) |
|---|---|---|
| `rev` | 8 | **9** |
| `maxOutputTokens` | 400 | **1024** |
| `fallbackModel` | absent | **`gemini-3.1-flash-lite`** |
| `enabledTools` | `get_member_summary, list_rewards` | `get_member_summary, list_rewards,` **`list_my_bookings, propose_booking, create_booking_request, propose_booking_change, confirm_booking_change, propose_booking_cancel, confirm_booking_cancel`** |

- **Unchanged:** every other key, verified by diffing before and after. 17 keys before, 18 after; the only key
  added is `fallbackModel` and none was removed. This covers mode `auto`, model `gemini-3.5-flash-lite`,
  `handoffSilenceHours` 12 and the text keys.
- **Not added:** `get_booking_link` (omc is simple mode) and `handoff_to_staff` (Xavier unticked it).
- `failureAction` stays absent, so the code default `handoff` applies.
- `booking_config` was not touched.

## Post-Deploy Verification (read-only, no data created, no WhatsApp message; ALL PASS)
| check | result |
|---|---|
| release | `git ls-remote origin refs/heads/release` = `fdc9cbe8ace40deff90e7fe32d99e559583dac91` (was `da99e4d4`) |
| served build | `/login` **200**, embeds `caIeIeX7IH0Qzhqp5AyPG` once and the old BUILD_ID 0 times; `/api/health` 200 |
| worker | `[AgentReplyQueue] Worker started`, `Workers started: … agent-reply` after the restart |
| stability | 13:22:42Z: next-server 3237666 elapsed 4:32, worker 3237725 4:27, no restart |
| logs (3 min+) | worker: 0 lines after the start banner, 0 error/warn. App: 2 lines after `Ready` (`Running next.config.ts`, the known standalone warning), 0 error lines |
| Gemini (prod key) | from the box, key read from the site `.env` in memory (no temp file, never printed). One fake `list_rewards` tool, no diner data. **`gemini-3.5-flash-lite` 200** in 7,533 ms and **`gemini-3.1-flash-lite` 200** in 12,618 ms. Both STOP with a `functionCall` part plus `thoughtSignature` (`ac-smoke-gemini.log`) |
| box after | MemAvailable 2,300 MB, swap 103 MB free, load 0.43, disk 27,401 MB free |
| not run | authenticated UI, any tenant login, any WhatsApp send. Xavier tests the booking flow on omc's number himself |

## Rollback (ready, NOT executed; ETR ≈ 1–2 min)
1. **omc config restore, no redeploy.** Put back the rev-8 object from `omc-agent-config-before.json` with rev 10,
   CAS on the current rev. Alternatively, untick the booking tools in Settings → AI agent → Advanced as an omc admin.
   The quickest stop is mode `off`:
   ```sql
   UPDATE restaurants SET agent_config = jsonb_set(jsonb_set(agent_config,'{mode}','"off"'),'{rev}',to_jsonb((agent_config->>'rev')::int + 1)) WHERE id = '2e578557-e903-4b1d-877e-598b43956c39';
   ```
2. **Code** to the BOOK-003 release (`da99e4d4` = `main@45a10231`, BUILD_ID `4VXrhhE4uWnAnm-o-34bu`). This is a
   force-push to `release` and **needs Xavier's OK**:
   ```
   cd /Users/xavierau/Code/js/whatsapp-crm       # local refs are shared by every worktree of this repo
   rtk proxy git push --force origin release-backup-da99e4d:refs/heads/release
   git ls-remote origin refs/heads/release       # must read da99e4d46890e407a4a94f9ca0a1b5d5fe84b8df
   # Forge redeploys: RELEASE.json source_commit 45a10231, both pids change, /api/health 200.
   ```
   If the local ref is gone, force-push by SHA `da99e4d46890e407a4a94f9ca0a1b5d5fe84b8df`.
   - Old code with booking tools ticked: `resolveEnabledTools` there drops names it does not know, so the stored
     list is harmless.
   - Rows with status `cancelled` or a change request would show in the old staff UI only as the raw status.
3. **085 is additive and stays.** The old code never writes `handoff`, `cancelled` or change requests.
   - A DB revert is a separate owner decision. It would drop the function, the index, the 3 columns and the
     cancel_marker CHECK, restore the 084 status / decision CHECKs and the 084 outcome CHECK and reply index, and
     delete the `085` ledger row.
   - Any `cancelled` row must be resolved first.
   - Row copies are on the box: `booking_requests.json`, `agent_messages.json` and `restaurants.json`.

## Cleanup
| item | state |
|---|---|
| remote `rel-agent003` | deleted ~13:23Z; `ls-remote origin refs/heads/rel-agent003` empty |
| local ref `release-backup-da99e4d` | kept as the rollback handle |
| `origin/release` `da99e4d4` → `fdc9cbe8` | replaced (force-push by `release.sh`, by design) |
| box `/home/forge/rel-agent003-tmp/` (query helper, SQL, probe; no secrets) | deleted after the records |
| box `/home/forge/backups/2026-11-19-agent-003/` | kept; delete once the release is accepted |
| worktree `--release-agent003` | removed with `git worktree remove` after the docs PR was pushed |
| worktree `--agent-003` (`feature/agent-003-agent-booking`) | untouched (per brief) |
