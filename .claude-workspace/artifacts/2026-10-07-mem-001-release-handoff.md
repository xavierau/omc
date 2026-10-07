---
id: artifacts/2026-10-07-mem-001-release-handoff
type: handoff
contract: handoff-file-v1
author: devops-engineer
created: 2026-10-07
status: active
item: MEM-001
state: done
brief: inline (MEM-001 + MEM-004 production release, PR #172, migrations 080 + 081)
base: 07316f362a86ead57a42782c63d1faaef81a9aea
head: d73b7e2a1a5e042e82594b6b582b6b3041713c96
branch: main
pushed: true
stage: poc
gate: {result: pass, at: 2026-10-07T08:45Z}
next: {owner: none, action: "owner manual members-page check (AC-5 substitute)"}
blockers: []
refs: [deploys/2026-10-07-mem-001-004-release-runbook, github:172, kanban:MEM-001, kanban:MEM-004]
---
ac:
  AC-1: {result: pass, evidence: "PR #172 merged 08:41:15Z; ls-remote refs/heads/main = d73b7e2a1a5e042e82594b6b582b6b3041713c96"}
  AC-2: {result: pass, evidence: "managed backup 1887852771 (2026-10-06T19:26:59Z) + events export 8,876 rows sha256 359e92c8… + catalog snapshot at box /home/forge/backups/2026-10-07-mem-001-004/; whatsapp_messages 5,346 rows / 7.0 MB → in-migration index path"}
  AC-3: {result: pass, evidence: "deploy.sh db push applied 080+081; ledger 079/080/081; fn ACL {postgres,service_role}; idx valid; CHECK 20 types incl reachability_restored, convalidated"}
  AC-4: {result: pass, evidence: "release.sh exit 0, release 0071fa3, BUILD_ID AkWQ9N80t9yjaXRQRWYWu served; daemons RUNNING 2130560/2130632 uptime 0:02; /api/health 200"}
  AC-5: {result: skipped, evidence: "no pinned prod test account (ui-map secrets.local.json absent; environments.md prod TODO) — escalate_if clause; DB/PostgREST substitute checks in runbook"}
  AC-6: {result: pass, evidence: "docs commit on main, ls-remote verified (see return block head)"}
decisions:
  - "Migrations applied by Forge deploy.sh (db push, before restart) rather than by hand before release — keeps schema_migrations ledger; CAMP-012/013 precedent"
  - "Box RAM 476 MB avail / swap 76% at pre-flight judged not an escalate_if: off-box build, no npm ci, restart frees the 1.55 GB next-server; post-deploy 2,555 MB avail"
failed: []
invariants:
  - "Rollback handle: worktree /Users/xavierau/Code/js/whatsapp-crm-release-mem-001 local ref release-backup-7884616 — keep until release accepted"
unverified:
  - "Authenticated /dashboard/members UI (250/page, No tag, quality column, detail evidence) — owner manual check or a pinned prod smoke account"
  - "MEM-004 live path: no reachability_restored event yet (needs an inbound from one of 224 unreachable members)"
review_focus: []
scope_drift: []
in_flight: []
next_step: "Owner opens /dashboard/members on prod and confirms the four MEM-001 UI features; then delete the release worktree, backup ref and box backup dir."
