---
id: artifacts/2026-11-25-agent-006-fix2-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-25
status: active
item: AGENT-006
state: done
brief: inline (AGENT-006 fix round 2, re-review N1 + M1)
base: 997b90c4
head: 8fe00cda
branch: feature/agent-006-campaign-context
pushed: true
stage: poc
suite_changed: true
gate: {result: pass, at: 2026-11-25T04:30Z}
next: {owner: main, action: "merge PR #229 into develop (owner approved 2026-11-25), then release = worker restart, tick 最近的推廣"}
blockers: []
refs: [reviews/2026-11-25-agent-006-re-review, artifacts/2026-11-25-agent-006-fix1-handoff, artifacts/2026-11-25-agent-006-campaign-context-impl, github:229]
---
ac:
  AC-1: {result: pass, evidence: "red: tests/2026-11-25-agent-006/fix2-ac1-red.log (5 failed / 13, commit e7e9c3cd); green: fix2-ac1-green.log (30/30 over the two named files): message_type selected; QR-only template campaign with inline columns filled → dropped, no template read; inline text only for an accepted text send without template_id (template-typed and interactive null-template rows dropped, QR next to a text send keeps the text); carried template missing → dropped; drops do not cost an older campaign its place in the limit"}
  AC-2: {result: pass, evidence: "tests/2026-11-25-agent-006/fix2-ac2-gate.log: tsc exit 0; vitest 728 files passed / 17 skipped, 8411 tests passed, exit 0"}
  AC-3: {result: pass, evidence: "PR https://github.com/xavierau/omc/pull/229 head == local HEAD (rtk proxy git ls-remote); body notes N1/M1 fixed, M2–M4 accepted"}
decisions:
  - "N1 template send outside the scanned rows → drop [decide_yourself]. The scanned rows are the accepted ones (sent|delivered|read, 50 newest), so a template send missing from them either failed (the diner never got it) or is beyond the scan; showing it would again be text the diner may not have received"
  - "The limit (3) is now applied after the drops, not inside the fold: a dropped campaign no longer hides an older valid one. Cost: the campaigns and templates queries take every distinct id in the ≤50 scanned rows instead of ≤3 (still restaurant-scoped)"
  - "Inline-text test is message_type 'text' AND template_id null, OR'ed across the campaign's accepted rows, so the inline body plus its later QR row still resolve to the text"
  - "isInlineText names its parameter `send`, not `row`: the schema-contract parser reads `row.x =` (incl. `===`) as a row-builder write and attributed message_type to campaigns"
failed: []
invariants:
  - "get_recent_campaigns still takes no parameters; every query scoped by restaurant_id, sends also by the job's member_id; no migration"
  - "status filter is exactly sent|delivered|read"
  - "port type AgentCampaignContent unchanged; agent-reply.ts and agent-campaign-tool.ts untouched"
unverified:
  - "No real-model or prod walk this round (POC; unit tests only). Prod still shows 0 accepted QR-only rows (re-review), so N1 has no live case to observe"
review_focus:
  - "src/infrastructure/supabase/repositories/agent-campaign-repository.ts latestPerCampaign / resolveTemplates / contentOf"
scope_drift:
  - "none"
notes:
  - "A template row that IS returned but whose components parse to [] (malformed JSONB) still yields {components: [], editedAfterSend: false}; M1 covered only the missing row, so the round-1 test for that case was kept. Same misleading shape as M1; caller may want it dropped too"
  - "Pre-existing lint error in the repo test (react-hooks/rules-of-hooks on the `use` helper, present at 997b90c4); not changed"
  - "One whole-project tsc ran outside the heavy lock during the loop (process slip, ~20 s); the gate run itself was under the lock"
in_flight: []
next_step: "main merges PR #229 into develop and runs the release (worker restart, tick 最近的推廣)."
