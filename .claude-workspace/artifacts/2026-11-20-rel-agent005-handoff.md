---
id: artifacts/2026-11-20-rel-agent005-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-20
status: active
item: AGENT-005
state: done
brief: inline
base: 11e65e6e
head: fe1cdbfb
branch: docs/agent-005-release-records
pushed: true
gate: {result: pass, at: "2026-11-20T08:36:39Z"}
next: {owner: main, action: "merge records PR #220 into develop; owner fills omc 訂座規則 and live-checks an out-of-hours booking ask"}
blockers: []
refs: [deploys/2026-11-20-agent-005-release-runbook, kanban:AGENT-005, github:216, github:219, github:220]
---
ac:
  AC-1: "pass: npm ci, tsc --noEmit, vitest run exit 0 on 11e65e6e (683 files / 7,800 tests passed), once, heavy lock (evidence ac1-*)"
  AC-2: "pass: https://github.com/xavierau/omc/pull/219 merged 08:38:23Z → main fe1cdbfb; tree b284303a == 11e65e6e tree"
  AC-3: "pass: release.sh exit 0, scan clean, release d74942c1 → d05e6470; Forge 83536518 'Deploy complete', no migration; app 3671054 / worker 3671113 RUNNING, stable at 3m40s; RELEASE.json source_commit fe1cdbfb, build_id F2oHXhD6zjqi7IwuTmGfA == .next/BUILD_ID; /login 200 new BUILD_ID x1, old x0; /api/health 200; worker 'Workers started … agent-reply'; after restart Kapso known x2, limiter x0, other errors 0; omc booking_config has no bookingRules key, agent_config rev 11 md5 unchanged"
  AC-4: "pass: runbook, poc-log line, kanban AGENT-005 → done, INDEX + handoffs rows; records PR https://github.com/xavierau/omc/pull/220 into develop opened, not merged"
decisions:
  - "Release PR merged with a merge commit, as prior releases"
  - "Box checks ran over SSH (forge@34.158.58.133 accepted today); no Forge site command was needed"
  - "Local rollback ref release-backup-d74942c did not exist; created from origin/release (d74942c1), not pushed"
  - "omc config check returns counts and md5s only (public repo); token read in-process on the box, never printed"
failed: []
invariants:
  - "No migration, env, package or lockfile change in 1f2b9eb4..fe1cdbfb"
  - "omc agent_config rev 11, md5 cb96e1e4a9c5514f2f6e03de98bbad0b before and after; booking_config without bookingRules"
unverified:
  - "Settings → Booking 訂座規則 field and an out-of-hours agent reply on prod (need tenant login / WhatsApp send): owner live check"
  - "Whether a rolled-back build drops a saved bookingRules key on its next Booking-settings save (old resolveBookingConfig keeps known keys only; write path not traced)"
review_focus: []
scope_drift:
  - "Worktree ../whatsapp-crm--release-agent005 was removed after the records push, then re-added on docs/agent-005-release-records to fix this handoff file's format; it is left in place for main to remove (git worktree remove) after PR #220 merges"
next_step: "Merge records PR #220 into develop, then remove the worktree ../whatsapp-crm--release-agent005."
