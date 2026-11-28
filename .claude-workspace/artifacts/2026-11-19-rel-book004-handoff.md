---
id: artifacts/2026-11-19-rel-book004-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-19
status: active
item: BOOK-004
state: done
brief: inline (main, BOOK-004 release brief-v1)
base: f1fa26b8
branch: docs/book-004-release (records PR into develop, not merged)
pr: https://github.com/xavierau/omc/pull/199 (develop → main, merged before this run, f1fa26b8)
stage: poc
gate: {result: pass, at: 2026-11-19T14:28:49Z}
next: {owner: main, action: "merge the records PR into develop; staff try the calendar/table views on prod"}
blockers: []
refs: [deploys/2026-11-19-book-004-release-runbook, artifacts/2026-11-19-dev-book-004-r4-handoff, deploys/2026-11-19-agent-003-release-runbook, kanban:BOOK-004]
---
# REL-BOOK-004: BOOK-004 released to production

Prod serves `main@f1fa26b8`, release `79c2634f`, BUILD_ID `3swaJrxsFle8BXKvCxYCZ`, app pid 3267575, worker pid
3267616. No migration (deploy log: "Remote database is up to date."). Full record:
`deploys/2026-11-19-book-004-release-runbook`.

## ac
- **AC-1: pass.** Release worktree at `f1fa26b8`, heavy lock, 14:27:46–14:28:49Z: `npm ci`, `tsc --noEmit`,
  `vitest run` all exit 0 (652 files / 7,451 tests passed). Evidence: `artifacts/evidence/2026-11-19-book-004-release/ac-gate-*`.
- **AC-2: pass.** `release.sh` exit 0 (14:30:59–14:34:19Z); `ls-remote origin refs/heads/release` `fdc9cbe8` →
  `79c2634f`; BUILD_ID `3swaJrxsFle8BXKvCxYCZ`; bundle credential scan `clean` (`release-sh.log`).
- **AC-3: pass.** Forge deployment 83467950 finished 14:37:08Z; "Remote database is up to date." (no migration);
  `npm ci` skipped (lockfile unchanged); app 3237666 → 3267575, worker 3237725 → 3267616
  (`forge-deploy-83467950.log`, `box-after.log`).
- **AC-4: pass.** Served `/login` embeds `3swaJrxsFle8BXKvCxYCZ` (old 0×); `/api/health` 200; `/dashboard/bookings`
  307 → /login; `GET /api/dashboard/bookings?from=2026-11-01&to=2026-11-30` 401; served chunk
  `0s_j8m74ejgk_.js` contains `bookings-calendar` ×7; 0 error lines after restart (`ac-smoke.log`, `box-stability.log`).
- **AC-5: pass.** This record + deploy runbook + poc-log line, committed on `docs/book-004-release` off
  `origin/develop`, pushed (ls-remote == HEAD), PR into develop opened, not merged.

## Pre-flight facts
- Box 14:29:24Z: 27,390 MB disk free, MemAvailable 2,326 MB.
- Latest managed backup 2306777673 COMPLETED 2026-11-18T19:32:11Z (none taken: no migration).
- Restore point: local ref `release-backup-fdc9cbe` (= `fdc9cbe8`, not pushed).

## Rollback (needs Xavier's OK)
`rtk proxy git push --force origin release-backup-fdc9cbe:refs/heads/release` (or by SHA `fdc9cbe8ace40deff90e7fe32d99e559583dac91`).

## Notes
- Forge `POST …/commands` answered 202 with an empty body; the command id was read from the newest entry of
  `GET …/commands?sort=-created_at`.
- Evidence redactions (public repo): build owner email in the deploy log and `RELEASE.json`, the seeded admin's email
  and user id; the pre-release process list trimmed to this site's processes.
