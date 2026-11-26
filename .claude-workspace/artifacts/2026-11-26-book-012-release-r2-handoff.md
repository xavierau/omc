---
id: artifacts/2026-11-26-book-012-release-r2-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-26
status: active
supersedes: artifacts/2026-11-26-book-012-release-handoff
superseded_by: null
item: BOOK-012
state: done
brief: inline (BOOK-012 release (resume))
base: 38399078
head: ffcf73ac (origin/main, deployed; release b8976f99)
branch: docs/book-012-release-records (records PR into main)
pushed: true
stage: poc
suite_changed: false
gate: {result: pass, at: 2026-11-26, note: "BOOK-012/TPL-012 tree gated at c0ac99a5 (r2); BUILD-FONT-001 heavy-lock next build + tsc exit 0 on its branch; release.sh build of ffcf73ac exit 0. No suite re-run"}
next: {owner: main, action: "review and merge the records PR into main; sync main back into develop before the next develop→main release; owner live test on Kushiro"}
blockers: []
refs: [github:231, github:232, deploys/2026-11-26-book-012-release-runbook, artifacts/2026-11-26-book-012-migration-094-handoff, artifacts/2026-11-26-build-font-001-handoff, kanban:BOOK-012, kanban:TPL-012, kanban:BUILD-FONT-001, kanban:BUILD-FONT-002]
---
ac:
  AC-1: {result: pass, evidence: "#231 squash 4e870cb3 into develop 05:28:09Z; #232 develop→main merge ffcf73ac 05:29:16Z; origin/main has src/app/fonts/noto-sans-hk.css, decideRetry (route-booking-intent.ts:72,83), c37fdba0 (TPL-012) as ancestor"}
  AC-2: {result: pass, evidence: "release.sh exit 0 05:38:57Z; origin/release f495266e→b8976f99; RELEASE.json source_commit ffcf73ac == origin/main; deploy 84057118 log: 'Remote database is up to date.'; daemon-746791 pid 2511387, daemon-801730 pid 2511460 fresh; public /api/health 200 (evidence/…-release-r2/release-sh-tail.log, forge-deploy-84057118.log, box-after.log)"}
  AC-3: {result: pass, evidence: "earlierOutcome in 2 .next/server files; 'Noto Sans HK Fallback' in served 0a5yu-solyosa.css; public zh /login 200 in Chromium, 0 font 404s, 0 failed requests (prod-login-zh.json/.png). One non-font 404 (/favicon.ico), pre-existing by inference"}
  AC-4: {result: pass, evidence: "readback.log: kushiro true rev 3, bicho true rev 7, all 7 booking_config and agent_config md5 identical before/after the deploy; box-logs-10min.log at 05:50:15Z: worker 2× pruneOrphanIntegrationEvents (pre-existing, excluded), app 2× known Kapso listing line; no new error class"}
  AC-5: {result: pass, evidence: "records PR into main (number in the handoff block); runbook status executed with timestamps, code rollback (rebuilt bundle 0c41a4df + 094 file; f495266e reference) and 094 data rollback SQL with both ids"}
decisions:
  - "Squash for #231 (repo precedent); merge commit for #232 (develop→main precedent). No conflicts, so no workspace-file resolution was needed"
  - "Pending-migration check done from the Mac (ledger vs main's migration files) because the box's own dry run cannot pass before the new bundle lands"
  - "Rollback rewritten: force-pushing f495266e alone now fails deploy.sh's db push (ledger has 094, the old checkout lacks the file) before the restarts; rollback = rebuild 0c41a4df plus the 094 file"
  - "build-font worktree removed by hand (squash-merge refusal) after a per-file content check against origin/main; remote branches release-book012 and fix/build-noto-sans-hk-font deleted"
failed:
  - tried: "Forge site-command helper listing commands with page[size] in the URL"
    why: "curl globbing rejected the brackets; the POST had already created command 14679677"
    evidence: "the list showed one new command; it was polled, not re-posted"
    replaced_by: "curl -g"
invariants:
  - "booking_config and agent_config unchanged by the deploy"
  - "Do not delete the 094 ledger row on any rollback"
unverified:
  - "Owner test: 想定枱 to Kushiro → 立即訂位 CTA (runbook 'Ready to resume' step 4). Real traffic shows booking_reply rows since 04:51Z, but the r2 retry path itself was not exercised"
  - "/favicon.ico 404 predates this deploy (inferred from an empty diff on the serving files; the old build was not checked)"
review_focus: []
scope_drift: []
in_flight: []
cleanup:
  - "../whatsapp-crm--build-font: removed (slot released, worktree removed, local + remote branch deleted; restore from 978d3ed1)"
  - "../whatsapp-crm--book-012: see the follow-up commit on this PR (removed after the records were pushed)"
next_step: "Merge the records PR into main, then merge main into develop (kanban.json/INDEX.md diverge otherwise)."
---

# BOOK-012 release (resume) handoff

Released: main `ffcf73ac` (BOOK-012 + TPL-012 + BUILD-FONT-001) is live on app.ohmyclient.io as release `b8976f99`,
BUILD_ID `zhPLsPnYAGCuNAHqgZBzJ`. Migration 094 was already applied, so the deploy's db push found nothing. Details
and rollback: `deploys/2026-11-26-book-012-release-runbook` → "Resumed release (r2)" and "Rollback".
