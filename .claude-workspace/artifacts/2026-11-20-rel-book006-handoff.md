---
id: artifacts/2026-11-20-rel-book006-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-20
status: active
item: BOOK-006
state: blocked
brief: inline
base: 2113af2e2960d4ad11e8d127653398585020b0b8
head: 99f81731a69182098cfa49fd2293394c64f68d63
branch: docs/book-006-release-records
pushed: true
stage: poc
gate: {result: pass, at: 2026-11-20T03:07:10Z}
next: {owner: main, action: "merge the records PR into develop (touches .claude/kanban.json, so not a low-risk self-merge); owner does the live omc check"}
blockers:
  - "AC-4 literal fail: 1 pre-existing [AgentBooking] rate-limiter line after restart; rule accept (recommended, no rollback) or roll back — needs main/owner"
refs: [github:209, deploys/2026-11-20-book-006-release-runbook, artifacts/2026-11-20-book-006-handoff, artifacts/2026-11-20-book-006-change-request-pairs-impl, kanban:BOOK-006, github:207, github:208]
---
# REL-BOOK-006: BOOK-006 released to production

Prod serves `main@99f81731`, release `8de9aea6`, BUILD_ID `e1I15X2aClu1mW4QksVz2`, app pid 3545420, worker pid
3545481. No migration. Full record: `deploys/2026-11-20-book-006-release-runbook`. Evidence:
`artifacts/evidence/2026-11-20-book-006-release/`. All times UTC. `head` above is the released main commit.

ac:
  AC-1: {result: pass, evidence: "ac-gate-{npm-ci,tsc,vitest}.exit all 0 on 2113af2e, 03:04:21–03:07:10Z; vitest 663 files / 7,584 tests passed"}
  AC-2: {result: pass, evidence: "PR #208: merge-tree exit 0, tree 5dbcbe26 == develop; CodeRabbit pass; merged 03:10:34Z → 99f81731, tree == 2113af2e"}
  AC-3: {result: pass, evidence: "release-sh.exit 0, scan clean; ls-remote release e5ddd701 → 8de9aea6; forge-deploy-83521251.log: 'Remote database is up to date.', app + worker RUNNING, 'Deploy complete'"}
  AC-4: {result: fail, evidence: "box-after-deploy.log: RELEASE.json source_commit 99f81731, build_id == .next/BUILD_ID; ac-smoke.log: /login 200 new BUILD_ID ×1 old ×0, /api/health 200; worker 'Workers started: … agent-reply', 0 lines after; pids 3545420/3545481 stable at 03:20:07Z; ac4-db-read.log: read shape HTTP 201, 3 pending rows, 1 with replaces_booking_id. Exception: 1 × '[AgentBooking] rate limiter unavailable, allowing: Error' in the app log after restart — pre-existing (5 earlier occurrences, incl. under the AGENT-004 build), from create-agent-booking.ts withinWindow(), not changed by BOOK-006 (box-ratelimiter-line.log)"}
  AC-5: {result: pass, evidence: "runbook, poc-log line, kanban BOOK-006 → done (PRs 207, 208), INDEX deploys + artifacts lines and handoffs.md rows for BOOK-006 and AGENT-004, this file: committed on docs/book-006-release-records, PR into develop opened, not merged"}
decisions:
  - "Records PR left unmerged — it changes .claude/kanban.json [brief fixed; ~/Code/.claude/CLAUDE.md Always]"
  - "No DB backup taken — release has no migration and no data write"
  - "AC-4 rate-limiter line judged pre-existing, not a regression: no rollback proposed; main/owner may rule otherwise"
  - "handoffs.md created as a new tracked file (it was not in git); the primary checkout holds an untracked handoffs.md with older legacy rows that this file does not copy (they carry tenant/Meta ids and the repo is public)"
  - "INDEX also gained the BOOK-006 impl/handoff and AGENT-004 handoff lines (none were indexed)"
  - "built_by, seeded admin email and its user id redacted in committed evidence — repo is public"
failed:
  - tried: "Forge site command id from the POST response"
    why: "POST /commands returns 202 with an empty body (as the AGENT-004 run found)"
    evidence: "site command 14469781 probe"
    replaced_by: "newest entry of GET /commands?sort=-created_at matching the command text"
invariants:
  - "local ref release-backup-e5ddd70 (e5ddd701) is the rollback handle; not pushed"
unverified:
  - "BOOK-006 screen on omc's live bookings page — owner (needs a tenant login)"
  - "why the agent-booking rate limiter's incrWindow throws on prod (only the error class is logged, by design)"
review_focus: []
scope_drift: []
next_step: "Merge the records PR into develop; when the primary checkout pulls develop, its untracked .claude-workspace/handoffs.md blocks the checkout — move it aside first and merge its legacy rows by hand if wanted."
