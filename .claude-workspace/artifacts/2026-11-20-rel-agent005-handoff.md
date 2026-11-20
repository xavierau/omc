---
id: artifacts/2026-11-20-rel-agent005-handoff
type: artifact
author: dev
created: 2026-11-20
status: active
supersedes: null
superseded_by: null
related: [deploys/2026-11-20-agent-005-release-runbook, kanban:AGENT-005, github:216, github:219]
---

# Handoff: AGENT-005 release (dev, one-shot)

- **Stage:** POC (no `stages/mature.md` import). Hosting: existing Forge box.
- **Status:** done. Prod serves `main@fe1cdbfb` → release `d05e6470`, BUILD_ID `F2oHXhD6zjqi7IwuTmGfA`, no migration.
- **Primary artifact:** `deploys/2026-11-20-agent-005-release-runbook` (scope, pre-flight, runbook as executed,
  deploy facts, verification table, rollback, cleanup). Evidence: `artifacts/evidence/2026-11-20-agent-005-release/`.

## Acceptance
| id | result | evidence |
|---|---|---|
| AC-1 | PASS: `npm ci`, `tsc --noEmit`, `vitest run` exit 0 on `11e65e6e` (683 files / 7,800 tests passed), once, heavy lock | `ac1-*.exit`, `ac1-vitest.log` |
| AC-2 | PASS: release PR #219 merged 08:38:23Z → `fe1cdbfb`; tree `b284303a` == `11e65e6e` tree | https://github.com/xavierau/omc/pull/219 |
| AC-3 | PASS: release.sh exit 0, scan clean, `release` d74942c1 → d05e6470. Forge 83536518 `Deploy complete` with no migration; app and worker RUNNING with new pids (3671054 / 3671113), stable at 3m40s. RELEASE.json matches the merge commit and BUILD_ID. `/login` 200 serves the new BUILD_ID, not the old one; `/api/health` 200; worker `Workers started … agent-reply`. After the restart: Kapso known line ×2, limiter ×0, other errors 0. omc: no `bookingRules` key, `agent_config` rev 11 and md5 unchanged | `release-sh.log`, `forge-deploy-83536518.log`, `box-after-deploy.log`, `box-stability.log`, `omc-config-{pre,post}deploy.log` |
| AC-4 | PASS: runbook, poc-log line, kanban AGENT-005 → done, INDEX + handoffs rows. Docs PR into develop opened, not merged | this file's handoff block |

## Notes for main
- SSH as `forge@34.158.58.133` was **accepted** today, so the box checks ran over SSH (read-only) and no Forge site
  command was needed. Earlier runbooks say port 22 is firewalled.
- The local rollback ref `release-backup-d74942c` did not exist at the start, so this run created it from `origin/release`.
- The PR had no CI checks (`gh pr checks`: none reported). It was MERGEABLE/CLEAN.
- Rollback caveat: once the owner fills 訂座規則, a rolled-back build may drop the key on its next Booking-settings
  save. The runbook says to read the value first.

## Next
- main: merge the records PR into develop.
- Owner: fill omc's 訂座規則 in Settings → Booking (or rely on 餐廳資料 hours), then live-check that the agent
  refuses an out-of-hours time (the 10:00-before-11:00 case).
