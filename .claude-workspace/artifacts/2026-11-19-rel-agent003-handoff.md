---
id: artifacts/2026-11-19-rel-agent003-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-19
status: active
item: REL-AGENT-003
state: done
brief: inline (team-lead, REL-AGENT-003 brief-v1; resumed after main merged PR #197)
base: 7af9494b
branch: docs/agent-003-release-records (records PR into develop, not merged)
pr: https://github.com/xavierau/omc/pull/197 (develop → main, merged by main 13:13Z, f7ab94d6)
stage: poc
gate: {result: pass, at: 2026-11-19T13:04:53Z}
next: {owner: main, action: "merge the records PR into develop; Xavier tests the booking flow on omc's WhatsApp number; delete box backup dir once the release is accepted"}
blockers: []
refs: [deploys/2026-11-19-agent-003-release-runbook, artifacts/2026-11-19-agent-003-fix2-handoff, threats/2026-11-19-agent-003-agent-booking, kanban:AGENT-003]
---
# REL-AGENT-003: AGENT-003 released to production

Prod serves `main@f7ab94d6`, release `fdc9cbe8`, BUILD_ID `caIeIeX7IH0Qzhqp5AyPG`, app pid 3237666, worker
pid 3237725. Migration 085 applied before the restart. omc agent_config rev 9 with the booking tools. Full record:
`deploys/2026-11-19-agent-003-release-runbook`.

## ac
- **AC-GATE: pass.** `7af9494b`, heavy lock, 13:03:52–13:04:53Z.
  - `npm ci`, `tsc --noEmit` and `vitest run` all exit 0: 648 files / 7,348 tests passed.
  - Evidence: `artifacts/evidence/2026-11-19-agent-003-release/ac-gate-*`.
- **AC-BACKUP: pass.** Taken at 13:04:42Z, before the 13:13Z merge.
  - Managed backup **2306777673 COMPLETED 2026-11-18T19:32:11Z**.
  - Box `/home/forge/backups/2026-11-19-agent-003/` holds restaurants (7), booking_requests (2), agent_messages (20),
    the baseline catalog and the managed-backups list, each with its sha256 (runbook Pre-Flight).
- **AC-DEPLOY: pass.**
  - `ls-remote origin refs/heads/release` = `fdc9cbe8` (was `da99e4d4`).
  - Box HEAD `fdc9cbe8`; `RELEASE.json` source_commit `f7ab94d6` and build_id equal `.next/BUILD_ID`
    `caIeIeX7IH0Qzhqp5AyPG`.
  - pids changed: app 3129673 → 3237666, worker 3129734 → 3237725.
  - Forge deployment 83458453 log: `Applying migration 085…` → `Finished supabase db push.` → `Restarting daemons`.
    deploy.sh started at 13:17:50Z and the new processes at 13:18:10Z / 13:18:14Z.
- **AC-MIGRATION: pass (13:19:15Z).**
  - Ledger row `085 agent_booking_changes`.
  - `replaces_booking_id`, `cancelled_by` and `cancelled_at` present; the status CHECK allows `cancelled`.
  - `confirm_booking_change` exists (service_role only).
  - booking_requests count 2, unchanged vs backup; the other counts are unchanged too.
- **AC-OMC: pass.**
  - CAS keyed on rev 8, merge write, **1 row** at 13:19:50Z.
  - Changed keys, read back and diffed: `enabledTools` (+7 booking tools), `fallbackModel` (absent →
    `gemini-3.1-flash-lite`), `maxOutputTokens` (400 → 1024), `rev` (8 → 9). Nothing else changed.
  - `get_booking_link` and `handoff_to_staff` were not added.
- **AC-SMOKE: pass.**
  - `/login` 200 serving the new BUILD_ID; `/api/health` 200.
  - The worker started `agent-reply`.
  - 13:18:10–13:22:42Z: 0 error lines in the worker and app logs, no restart.
  - Gemini with the prod key from the box: `gemini-3.5-flash-lite` **200** in 7,533 ms, `gemini-3.1-flash-lite`
    **200** in 12,618 ms, each returning a functionCall.
- **AC-RECORD: pass.**
  - `deploys/2026-11-19-agent-003-release-runbook` covers scope, pre-flight, the runbook as executed, deploy facts,
    the 085 result, omc before → after, smoke and rollback.
  - Also written: one poc-log line and the kanban AGENT-003 notes.
  - All on `docs/agent-003-release-records`, in a PR into develop (not merged).

## unverified
- No live WhatsApp booking run: no message was sent, and Xavier tests it himself. The first real omc booking chat
  is the first live run of the booking tools, the fallback and the handoff on prod.
- Gemini latency was 7.5 s and 12.6 s for a single tool-call turn. A run that needs main → fallback within the
  20 s budget may be tight under overload; not measured beyond this probe.

## notes
- The dev's `gh pr merge 197` into main was denied by the permission system. Main merged #197 at 13:13Z and the
  run resumed.
- The Gemini key was read in memory from the site `.env`, not via the 600 temp file the brief described. No key
  material ever touched disk outside `.env`.
- `agent_messages` was added to the backup set because 085 rewrites its CHECK and its unique index.
- `npm ci` ran in the gate although the lockfile was unchanged: the fresh worktree had no `node_modules`.
