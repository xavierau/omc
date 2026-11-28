---
id: artifacts/2026-11-26-book-012-migration-094-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-26
status: active
item: BOOK-012
state: done
brief: inline (BOOK-012 migration-only release step)
base: 38399078
head: 38399078 (no commit; data-only step)
branch: release-book012
pushed: false
stage: poc
suite_changed: false
gate: {result: none, at: 2026-11-26, note: "no code change; migration file is the one in the gated main tree"}
next: {owner: main, action: "resume the code deploy after BUILD-FONT-001; its db push should find nothing pending"}
blockers: []
refs: [deploys/2026-11-26-book-012-release-runbook, artifacts/2026-11-26-book-012-release-handoff, kanban:BOOK-012]
---
ac:
  AC-1: {result: pass, evidence: "deploys/evidence/2026-11-26-book-012-migration-094/dryrun.log (only 094), push.log (exit 0, 04:51:11-19Z), migration-list.log (94 rows, 094 local==remote); ledger tail 094"}
  AC-2: {result: pass, evidence: "readback.log: kushiro false→true rev 2→3, bicho false→true rev 6→7, other keys byte-identical; other 5 md5 unchanged"}
  AC-3: {result: pass, evidence: "box-before-after.log: site commands 14678838 / 14678892, RELEASE.json 0c41a4df both, pids 626877/626977 unchanged, /api/health 200"}
  AC-4: {result: pass, evidence: "runbook section '094 applied ahead of deploy' (timestamps, outputs, rollback SQL with both ids and the rev CASE, resumed-deploy note); header and 'Ready to resume' steps 2-3 updated"}
decisions:
  - "Linked this tree (at origin/main 38399078) to uzimqndenngebzgndlhd for the push, then moved the 8 gitignored link-cache files to session scratch so the tree no longer targets prod — avoids a later accidental db push from here"
  - "Full booking_config blobs kept only in session scratch (mode 600); evidence in the workspace carries slugs, rev, aiRoutingEnabled and md5 only — the repo is public"
failed:
  - tried: "Forge site-command helper parsing the POST response for the command id"
    why: "POST returned an empty body; the helper then polled the list endpoint. No extra command ran on the box (list showed one command per call)"
    evidence: "commands 14678838 and 14678892 are the only ones created in this run"
    replaced_by: "read the newest command id from the list endpoint"
invariants:
  - "Do not delete the 094 ledger row on rollback; the data rollback SQL leaves it, so a later db push does not re-flip the tenants"
unverified:
  - "Classifier on real Kushiro/bicho traffic: no inbound message checked after 04:51Z — owner test in the runbook step 4"
review_focus: []
scope_drift:
  - "supabase/.temp/ link-cache files (gitignored) created by `supabase link`, then moved out to scratch; tracked cli-latest unchanged"
in_flight: []
next_step: "After BUILD-FONT-001 lands, resume from the runbook's 'Ready to resume' and confirm deploy.sh's db push reports nothing pending."
---

# BOOK-012 migration 094 handoff

094 is applied to prod ahead of the code deploy. Kushiro and bicho now have `aiRoutingEnabled` true at rev 3 and 7.
Prod code, pids and health are unchanged. Records: `deploys/2026-11-26-book-012-release-runbook` → "094 applied ahead
of deploy".
