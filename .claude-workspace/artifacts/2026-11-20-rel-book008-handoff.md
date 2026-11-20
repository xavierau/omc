---
id: artifacts/2026-11-20-rel-book008-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-20
status: active
item: BOOK-008
state: done
brief: inline (brief-v1 BOOK-008 release)
base: e751ee5af2c0f5639eb7a64a3256f1530091d200
head: 1f2b9eb44ad665ae4e0818cb6b66235d0a96f8b4
branch: docs/book-008-release-records
pushed: true
stage: poc
gate: {result: pass, at: 2026-11-20T06:06:40Z}
next: {owner: main, action: "merge the records PR into develop (touches .claude/kanban.json, so not a low-risk self-merge); release #216 hold; owner does the live member-panel / relink check on omc"}
blockers: []
refs: [deploys/2026-11-20-book-008-release-runbook, artifacts/2026-11-20-book-008-r1-handoff, artifacts/2026-11-20-book-008-member-bookings-impl, threats/2026-11-20-book-007-008-member-bookings, kanban:BOOK-008, kanban:BOOK-OPS-1, github:214, github:217]
---
# REL-BOOK-008: BOOK-008 released to production with migration 088

Prod serves `main@1f2b9eb4`, release `d74942c1`, BUILD_ID `Dy3BMrmauUbUY9gIzFdVI`, app pid 3661017, worker pid
3661081. Migration 088 was applied before both daemon restarts. Its backfill linked the one member-less booking. The
single post-deploy re-run touched 0 rows. Full record: `deploys/2026-11-20-book-008-release-runbook`. Evidence:
`artifacts/evidence/2026-11-20-book-008-release/`. Box backups: `/home/forge/backups/2026-11-20-book-008/`. All
times are UTC. `head` above is the released main commit.

ac:
  AC-1: {result: pass, evidence: "ac-gate-{npm-ci,tsc,vitest}.exit all 0 on e751ee5a, 06:04:04–06:06:40Z, run once under the heavy lock; vitest 678 files / 7,761 tests passed"}
  AC-2: {result: pass, evidence: "ac2-events-precheck.log 06:05:48Z: prod distinct types {campaign, consent_imported, join, redeem, whatsapp_error} all in 088's 21-type list, PRECHECK PASS; ac2-box-backup.log 06:06:38–42Z (PR #217 opened 06:07:25Z): managed-backups.json, booking_requests.json (5 rows), members.json (id, restaurant_id, phone; 4,229), baseline-catalog.json, baseline-ids.json, 600 in a 700 dir, sha256 in the runbook; newest managed backup 2317028887 COMPLETED 2026-11-19T19:32Z"}
  AC-3: {result: pass, evidence: "PR #217 https://github.com/xavierau/omc/pull/217: merge-tree exit 0, tree 018355e2 == develop; MERGEABLE/CLEAN, CodeRabbit pass; merged 08:14:39Z (merge commit) → 1f2b9eb4, tree 018355e2 == e751ee5a tree"}
  AC-4: {result: pass, evidence: "release-sh.exit 0, scan clean, BUILD_ID Dy3BMrmauUbUY9gIzFdVI; release ca44103a → d74942c1; forge-deploy-83534624.log: 088 applied, 'Finished supabase db push.' before the daemon-746791 and daemon-801730 restarts, 'Deploy complete'; RELEASE.json source_commit 1f2b9eb4 == main merge, build_id == .next/BUILD_ID; /login 200, new BUILD_ID ×1, 2X-ml2OJycTIYik4jAYvg ×0; /api/health 200; 'Workers started: … agent-reply'; box-stability.log 08:25:04Z (5m12s after restart): same pids, 0 error lines, known lines counted Kapso 0 / limiter 0"}
  AC-5: {result: pass, evidence: "ac5-post-catalog.log 08:20:42Z: ledger 088; events_type_check includes booking.member_relinked; relink_booking_member, member_booking_stats, link_member_bookings EXECUTE anon false, authenticated false, service_role true; trigger trg_members_link_bookings AFTER INSERT on members; index present; booking_requests 5 == baseline 5, ids identical, status mix unchanged. ac5-backfill-rerun.log 08:22:34–40Z: dry count 0, the verbatim 088 UPDATE once, rows affected 0. member_id NULL: baseline 1 → after 088 0 → after re-run 0"}
  AC-6: {result: pass, evidence: "runbook, poc-log line, kanban BOOK-008 review → done (PRs 214, 217) + backlog BOOK-OPS-1, INDEX deploys line + BOOK-008 artifacts block, handoffs.md row, this file: committed on docs/book-008-release-records, PR into develop opened, not merged"}
decisions:
  - "Release PR merged with a merge commit, as for #211 [decide_yourself]"
  - "Took a read-only pre-deploy snapshot (08:14:58Z) after the session break, so that deltas trace from a fresh point; it equalled the 06:06Z backup byte for byte. The pre-PR backup stays the AC-2 backup"
  - "Backfill rows-affected is measured as the matching count before minus after. The Management API returns [] for an UPDATE without RETURNING, and adding RETURNING would break 'verbatim'"
  - "The UPDATE text was extracted programmatically from 088 at e751ee5a; the same sha256 is shown on the Mac and on the box"
  - "Records PR left unmerged: it changes .claude/kanban.json [brief fixed]"
  - "built_by, the seeded admin email and its user id are redacted in the committed Forge log; the repo is public"
failed:
  - tried: "Forge site-command polling every 3 s"
    why: "Forge answered 'Too many attempts' at about 08:20:45Z, while the post-deploy catalog command was in flight"
    evidence: "runbook Notes"
    replaced_by: "polling every 10 s; the in-flight read-only command (14475786) had run, and its output was fetched, not re-run"
  - tried: "first rm -rf of /home/forge/rel-book008-tmp"
    why: "an earlier chmod 600 * had removed the x bit from __pycache__"
    evidence: "box-cleanup.log"
    replaced_by: "chmod 700 on that dir, then rm -rf; the dir is gone (08:25:39Z)"
invariants:
  - "local ref release-backup-ca44103 (ca44103a) is the rollback handle; not pushed"
  - "088 stays on any code rollback; its DB revert (trigger dropped first) is in the runbook and is the owner's decision"
  - "no tenant login, no WhatsApp send, no relink and no member insert on prod; the only write besides the deploy was the one backfill re-run (0 rows)"
unverified:
  - "Member panel bookings + stats and the manual link/relink/unlink in the live app: owner check (needs a tenant login; a relink is a DB write)"
  - "link_member_bookings() firing on a real member insert on prod: none happened in the window (members 4,229 unchanged). Proven only on the scratch DB in the r1 handoff"
review_focus: []
scope_drift: []
next_step: "Main merges the records PR into develop and releases the #216 hold. Delete /home/forge/backups/2026-11-20-book-008/ once the release is accepted. Pre-existing workspace rot, not repaired: INDEX.md is about 290 lines with inline entries while active/ exists (workspace-curate check)."
