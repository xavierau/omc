---
id: artifacts/2026-11-25-agent-006-fix1-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-25
status: active
item: AGENT-006
state: done
brief: inline (AGENT-006 fix round 1, /code-review high PR #229 F1–F5)
base: dee8fdde
head: efd955e7
branch: feature/agent-006-campaign-context
pushed: true
stage: poc
suite_changed: true
gate: {result: pass, at: 2026-11-25T04:10Z}
next: {owner: main, action: "re-review PR #229 at the pushed head (F1–F5), then release = worker restart"}
blockers: []
refs: [artifacts/2026-11-25-agent-006-handoff, artifacts/2026-11-25-agent-006-campaign-context-impl, tests/2026-11-25-agent-006/fix1-ac3-README, github:229]
---
ac:
  AC-1: {result: pass, evidence: "red: tests/2026-11-25-agent-006/fix1-ac1-red.log (10 failed / 4 files, commit dba61322); green: fix1-ac1-green.log (45/45): inline text + language pick, no campaigns.whatsapp_template_id fallback, editedAfterSend + skill rule, placeholder URL note, no campaignName, emoji at 1500 kept whole"}
  AC-2: {result: pass, evidence: "tests/2026-11-25-agent-006/fix1-ac2-gate.log: tsc exit 0; vitest 728 files passed / 17 skipped, 8406 tests passed, GATE_EXIT=0"}
  AC-3: {result: pass, evidence: "tests/2026-11-25-agent-006/fix1-ac3-README.md: template updated after the send on 0 of 2,139 accepted campaign sends (30 d), 0/4,302 (60 d), 0/6,568 (90 d); updated_at moves on every UPDATE (trigger 009), status-only included"}
  AC-4: {result: pass, evidence: "PR https://github.com/xavierau/omc/pull/229 head == local HEAD (ls-remote); body lists F1–F5"}
decisions:
  - "F1 language = the send's own chain (resolvePreferredLanguage: member → restaurant default → zh_hk; then resolveLocalizedTemplate: that language → the other → legacy template). The brief said 'else zh_hk then en'; that differs only for an en-default restaurant (prod: all 7 zh_hk) [decide_yourself]"
  - "F2 flag name editedAfterSend; reference time = queued_at of the newest send that carried the template"
  - "Port content is a union {kind:'template', components, editedAfterSend} | {kind:'text', text}; the campaigns query no longer reads name or whatsapp_template_id"
  - "parse-schema.ts (test helper, __tests__) now reads every ADD COLUMN of one ALTER TABLE: 029 adds template_en and template_zh_hk in one statement and the contract test missed the second"
failed: []
invariants:
  - "get_recent_campaigns still takes no parameters; every query scoped by restaurant_id, sends also by the job's member_id"
  - "status filter is exactly sent|delivered|read"
  - "skill text does not contain 'TABLE BOOKINGS'"
unverified:
  - "No live inline-text send exists to walk: in 90 days every accepted campaign send carried a template_id; the 250 null-template rows in 60 days are failed coupon-QR images (fix1-ac3-prod-status-60d.log)"
  - "No real-model walk this round (POC; unit + prod counts only)"
review_focus:
  - "src/infrastructure/supabase/repositories/agent-campaign-repository.ts contentOf / sendLanguage / templateContent"
  - "src/application/agent/skills/campaigns-skill.ts editedAfterSend rule wording"
scope_drift:
  - "none"
in_flight: []
next_step: "main re-reviews PR #229; the round-1 release step (worker restart, tick 最近的推廣) is unchanged."
