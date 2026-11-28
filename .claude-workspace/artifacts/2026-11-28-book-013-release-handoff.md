---
id: artifacts/2026-11-28-book-013-release-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-28
status: active
supersedes: null
superseded_by: null
item: BOOK-013
state: done
brief: inline brief-v1 BOOK-013 release (owner go 2026-11-28 "release to production")
base: 28835faf
head: "main 875bdb95 (PR #240); release 655cd089; records on docs/book-013-release-records"
branch: docs/book-013-release-records
pushed: true
stage: poc
suite_changed: "n/a (release; no code change)"
gate: {result: "parity, not re-run", at: 2026-11-27T06:33Z}
next: {owner: main, action: "relay owner steps: template backfill go, pilot walk; merge the records PR"}
blockers: []
refs: [deploys/2026-11-28-book-013-release-runbook, deploys/evidence/2026-11-28-book-013-release, pr:240, kanban:BOOK-013]
related: [artifacts/2026-11-27-book-013-phone-optional-r2-handoff, artifacts/2026-11-26-book-013-r3-handoff]
---
ac:
  AC-1: {result: pass, evidence: "PR #240 merge commit 875bdb95 (01:34:58Z, --match-head-commit 28835faf); origin/release b8976f99 → 655cd089; box RELEASE.json source_commit 875bdb95 (box-after.log); forge-deploy-84247724.log applies 095 then 096 before 'Restarting daemons'; box supabase migration list --linked shows 095 and 096 local == remote"}
  AC-2: {result: pass, evidence: "pids 3456741 / 3456813 (up 0:00:47 / 0:00:42 at 01:40:15Z); public /api/health 200; bookings-today-sort in .next/static/chunks/1gftfk8gz3nr9.js, phone_required in 10 .next/server files; readback.log: edit_version, notify_diner, checked_in_at present, phone nullable, booking_requests_phone_staff_only + booking_requests_no_phone_no_notify present (read_only)"}
  AC-3: {result: pass, evidence: "deploys/2026-11-28-book-013-release-runbook + kanban BOOK-013 → done + both review files in the records PR (URL and ls-remote in the runbook Cleanup and the final handoff block)"}
decisions:
  - "New PR #240 for develop → main: no develop → main PR was open."
  - "Pre-flight run twice: the first run (16:33Z 11-27) was ~9 h old at merge time, so I re-checked the box and the ledger at 01:35Z before building."
  - "Carried files committed first on docs/book-013-release-records (87fd9426), then the release branch was checked out, so release.sh saw a clean tree and nothing was discarded. The r3 re-review was already tracked; only the phone-optional review was untracked."
  - "No signed-in prod walk: staff CRUD writes real rows and can message diners; left as the owner's pilot step."
failed: []
invariants:
  - "Template backfill not run."
  - "No push to main other than through PRs; no force-push by me (release.sh's orphan replace of `release` is its normal operation)."
unverified:
  - "BOOK-013 flows on prod with a signed-in staff user (no walk)."
review_focus: []
scope_drift: []
in_flight: []
next_step: "Owner: go/no-go for the template backfill; pilot walk; merge the records PR."
---
