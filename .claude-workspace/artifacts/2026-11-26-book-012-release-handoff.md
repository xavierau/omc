---
id: artifacts/2026-11-26-book-012-release-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-26
status: superseded
superseded_by: artifacts/2026-11-26-book-012-release-r2-handoff
item: BOOK-012
state: blocked
brief: inline (BOOK-012 release)
base: 7afa7622
head: 38399078 (origin/main; nothing deployed)
branch: release-book012 (remote kept)
pushed: true
stage: poc
suite_changed: false
gate: {result: pass, at: 2026-11-26, note: "tree 51e41efe equals the r2 gated c0ac99a5 outside the workspace; not re-run"}
next: {owner: main, action: "decide how to unblock the Turbopack next/font/google build failure, then resume from the runbook's 'Ready to resume'"}
blockers:
  - "next build fails (2 of 2 tries, 04:36Z and 04:42Z): 327 Turbopack errors, one for each Noto Sans HK next/font/google slice ('next/font/google queries have exactly one entry'). No font, Next or lockfile change in this release. Fixing it needs a code change outside files_allowed."
refs: [pr:230, pr:228, pr:227, kanban:BOOK-012, kanban:TPL-012, deploys/2026-11-26-book-012-release-runbook]
---
ac:
  AC-1: {result: pass, evidence: "PR #230 merged 04:17:39Z (squash 0715b4eb); PR #228 develop→main merged 04:27:59Z (38399078). git ls-tree origin/main has 094_booking_ai_routing_default_on.sql; git grep origin/main finds decideRetry (route-booking-intent.ts:72,83) and 'aiRoutingEnabled !== false' (booking-config.ts:188)"}
  AC-2: {result: blocked, evidence: "GET-before saved (scratch booking-config-before.json, 600, sha256 5fa94630…); stored-false = {bicho 55f33c80-62c2-4050-8330-5b6c38ea804f, kushiro}; ledger pending = only 094. Migration not applied: the deploy never ran"}
  AC-3: {result: blocked, evidence: "release.sh exit 1 twice at next build; origin/release still f495266e; prod RELEASE.json 0c41a4df, pids unchanged, /api/health 200 at 04:42Z"}
  AC-4: {result: pass, evidence: "04:12:39Z from the box: Decisions API gemini-decision-1 HTTP 200, choice booking 0.98; no 429"}
  AC-5: {result: partial, evidence: "runbook written (status blocked) with pre-flight, steps, the failure, resume steps, the owner test and the rollback SQL with both ids; untracked in the worktree; docs PR not opened (waits for the release)"}
decisions:
  - "Used the existing release PR #228 (TPL-012, opened 2026-11-24) for develop→main instead of a second PR; title and body updated to name BOOK-012"
  - "TPL-012 rides along: it was on develop and unreleased, and the brief releases develop"
  - "Migration order: left to deploy.sh (db push before restarts), which is migration first"
  - "Retried the build once to check it reproduces (no prod effect), then stopped per escalate_if"
failed:
  - "release.sh try 1 and try 2: Turbopack build failed with 327 errors (next/font/google Noto Sans HK)"
invariants:
  - "Prod unchanged: release f495266e, main@0c41a4df serving, migration ledger at 093, booking_config untouched"
unverified:
  - "Root cause of the font failure. Hypothesis: the Google Fonts css2 response changed since the 11-22 build and Turbopack in Next 16.3.4 rejects it; a build of 0c41a4df would tell (not run)"
review_focus: []
scope_drift: []
in_flight:
  - "main is ahead of prod with BOOK-012 + TPL-012, not deployed"
  - "records (runbook, this file, evidence excerpts) untracked in ../whatsapp-crm--book-012; kanban not moved"
next_step: "Fix the build (e.g. next/font/local for Noto Sans HK, or `next build --webpack`), merge it to main, then follow the runbook's 'Ready to resume'."
---

# BOOK-012 release handoff

The run stopped at the build. Both merges are done, so main is ahead of prod. Nothing was deployed and nothing in
the DB changed. The resume steps are in `deploys/2026-11-26-book-012-release-runbook` under "Ready to resume".
