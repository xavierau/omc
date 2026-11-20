---
id: artifacts/2026-11-20-rel-agent004-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-20
status: active
item: AGENT-004
state: blocked
brief: inline
base: 94e868ed4959e99a238cd4c3cc44f979ed9a7584
head: 4af4caaf6d43b2af66fda67c0fdd789f36177b9c
branch: docs/agent-004-release-records
pushed: true
stage: poc
gate: {result: pass, at: 2026-11-20T02:27:02Z}
next: {owner: main, action: "merge records PR #206 into develop (touches .claude/kanban.json, so not a low-risk self-merge); owner does the live omc check"}
blockers:
  - "merge PR #206 (CLEAN, CodeRabbit pass) — needs main/owner: .claude/ paths never count as low-risk"
  - "INDEX.md deploys line + handoffs.md row not written (outside files_allowed) — needs main"
  - "live omc check of AGENT-004 behaviour — needs owner"
refs: [deploys/2026-11-20-agent-004-release-runbook, artifacts/2026-11-20-agent-004-handoff, kanban:AGENT-004, github:204, github:205, github:206]
---
# REL-AGENT-004: AGENT-004 released to production

Prod serves `main@4af4caaf`, release `e5ddd701`, BUILD_ID `zzJgH7D65-G0P4rKNa3uS`, app pid 3531138, worker pid
3531178. No migration. Full record: `deploys/2026-11-20-agent-004-release-runbook`. Evidence:
`artifacts/evidence/2026-11-20-agent-004-release/`. All times UTC. `head` above is the released main commit; the
records commit on `branch` is `8fcc58f1` plus this file's update.

ac:
  AC-1: {result: pass, evidence: "ac-gate-{npm-ci,tsc,vitest}.exit all 0 on 94e868ed, 02:25:16–02:27:02Z; vitest 661 files / 7,541 tests passed"}
  AC-2: {result: pass, evidence: "PR #205: merge-tree exit 0, tree 6f4dc031 == develop; CodeRabbit pass (no GitHub workflows, as #202); merged 02:31:57Z → 4af4caaf, tree == 94e868ed"}
  AC-3: {result: pass, evidence: "release-sh.exit 0, scan clean; ls-remote release b40e2e29 → e5ddd701; forge-deploy-83519795.log: 'Remote database is up to date.', app + worker RUNNING, 'Deploy complete'"}
  AC-4: {result: pass, evidence: "box-after-deploy.log: RELEASE.json source_commit 4af4caaf, build_id == .next/BUILD_ID; ac-smoke.log: /login 200 new BUILD_ID ×1 old ×0, /api/health 200; box-stability.log 02:44:12Z: 0 new error lines, pids 3531138/3531178 unchanged, 'Workers started: … agent-reply'"}
  AC-5: {result: fail, evidence: "runbook, poc-log line, kanban AGENT-004 → done (PRs 204, 205), this file: committed and pushed on docs/agent-004-release-records, PR #206 open; not merged (see blockers)"}
decisions:
  - "Records PR #206 left unmerged — it changes .claude/kanban.json and the owner's rule says .claude/ never counts as low-risk [~/Code/.claude/CLAUDE.md Always]"
  - "No DB backup taken — release has no migration and no data write"
  - "built_by and seeded-admin emails redacted in committed evidence — repo is public"
failed:
  - tried: "Forge site command id from the POST response"
    why: "POST /commands returns 202 with an empty body"
    evidence: "raw response, 02:28:03Z"
    replaced_by: "newest entry of GET /commands?sort=-created_at matching the command text"
invariants:
  - "local ref release-backup-b40e2e2 (b40e2e29) is the rollback handle; not pushed"
unverified:
  - "AGENT-004 behaviour on a real diner thread — owner (live omc check)"
review_focus: []
scope_drift: []
next_step: "Merge PR #206 into develop, then add the INDEX.md deploys line and the handoffs.md row."
