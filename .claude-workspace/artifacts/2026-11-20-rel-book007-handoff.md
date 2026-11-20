---
id: artifacts/2026-11-20-rel-book007-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-20
status: active
item: BOOK-007
state: blocked
brief: inline
base: 460d94909f4ed0c5e595a1a8efce0fbf53cbd68c
head: 23dc635f00bfd2b807842a7794acc99e04dbb0aa
branch: docs/book-007-release-records
pushed: true
stage: poc
gate: {result: pass, at: 2026-11-20T04:13:01Z}
next: {owner: main, action: "rule on the pre-existing [Kapso] warn line (AC-4); merge the records PR into develop (touches .claude/kanban.json, so not a low-risk self-merge); owner does the live no-show check on omc"}
blockers:
  - "AC-4 literal fail: pre-existing '[Kapso] Error listing templates: WhatsApp configuration not found' warn lines after restart; rule accept (recommended, no rollback) or roll back — needs main/owner"
refs: [deploys/2026-11-20-book-007-release-runbook, artifacts/2026-11-20-book-007-r1-handoff, artifacts/2026-11-20-book-007-handoff, artifacts/2026-11-20-book-007-no-show-impl, threats/2026-11-20-book-007-008-member-bookings, kanban:BOOK-007, github:210, github:211]
---
# REL-BOOK-007: BOOK-007 released to production with migration 087

Prod serves `main@23dc635f`, release `ca44103a`, BUILD_ID `2X-ml2OJycTIYik4jAYvg`, app pid 3573648, worker pid
3573713. Migration 087 was applied before both daemon restarts. Full record: `deploys/2026-11-20-book-007-release-runbook`.
Evidence: `artifacts/evidence/2026-11-20-book-007-release/`. Box backups: `/home/forge/backups/2026-11-20-book-007/`.
All times UTC. `head` above is the released main commit.

ac:
  AC-1: {result: pass, evidence: "ac-gate-{npm-ci,tsc,vitest}.exit all 0 on 460d9490, 04:09:37–04:13:01Z; vitest 669 files / 7,658 tests passed"}
  AC-2: {result: pass, evidence: "box-backup.log: 04:11:09–11Z (before PR #211 was opened at 04:13:23Z); managed-backups.json, booking_requests.json (5 rows), baseline-catalog.json, 600 in a 700 dir, sha256 recorded; newest managed backup 2317028887 COMPLETED 2026-11-19T19:32Z"}
  AC-3: {result: pass, evidence: "PR #211: merge-tree exit 0, tree 75c2d837 == develop; MERGEABLE/CLEAN, CodeRabbit pass; merged 04:23:17Z (merge commit) → 23dc635f, tree == 460d9490 tree"}
  AC-4: {result: fail, evidence: "release-sh.exit 0, scan clean; release 8de9aea6 → ca44103a; forge-deploy-83523830.log: 087 applied, 'Finished supabase db push.' before daemon-746791 and daemon-801730 restarts, 'Deploy complete'; RELEASE.json source_commit 23dc635f, build_id == .next/BUILD_ID; /login 200 new BUILD_ID ×1 old ×0; /api/health 200; 'Workers started: … agent-reply'; pids stable at 04:32Z and 05:14Z; 0 limiter lines. Exception: 2 (later 6) '[Kapso] Error listing templates: WhatsApp configuration not found' warn lines — pre-existing (6,694 earlier, incl. under the AGENT-004 and BOOK-006 builds), template-client.ts unchanged (box-stability.log)"}
  AC-5: {result: pass, evidence: "ac5-post-catalog.log: ledger 087; status CHECK has no_show; no_show_marked_by/at; decision_consistent and no_show_marker as in 087; mark_booking_no_show EXECUTE anon false, authenticated false, service_role true; booking_requests 5 == baseline 5; 0 no_show rows. Status mix moved (1 unverified purged by the reminders cron, 1 new pending agent booking at 04:24Z, old build); 4 kept rows unchanged"}
  AC-6: {result: pass, evidence: "runbook, poc-log line, kanban BOOK-007 review → done (PRs 210, 211), INDEX deploys line + BOOK-007 artifacts block, handoffs.md row, this file: committed on docs/book-007-release-records, PR into develop opened, not merged"}
decisions:
  - "Release PR merged with a merge commit, like #208 [decide_yourself]"
  - "AC-4 Kapso line judged pre-existing, not a regression: no rollback proposed; recorded as a literal fail as in the BOOK-006 precedent, since main's ruling named only the limiter line"
  - "Records PR left unmerged — it changes .claude/kanban.json [brief fixed]"
  - "Status-mix change after the baseline traced on the box (ids compared there, not printed) rather than taking count equality as proof that no row changed"
  - "built_by, seeded admin email and its user id redacted in committed evidence — repo is public"
failed:
  - tried: "nothing failed in the release path"
    why: "n/a"
    evidence: "n/a"
    replaced_by: "n/a"
invariants:
  - "local ref release-backup-8de9aea (8de9aea6) is the rollback handle; not pushed"
  - "087 stays on any code rollback; its DB revert is in the runbook and is the owner's decision"
unverified:
  - "Mark no-show / Undo on omc's live bookings page — owner (needs a tenant login and a DB write)"
  - "what schedules the Kapso template-list calls for a tenant with no WhatsApp configuration (looked in: app log timing only)"
review_focus: []
scope_drift: []
next_step: "Main rules on the Kapso line, merges the records PR into develop; delete /home/forge/backups/2026-11-20-book-007/ once the release is accepted. Pre-existing workspace rot (not repaired): INDEX.md is 285 lines with 211 inline entries while active/ exists (workspace-curate check)."
