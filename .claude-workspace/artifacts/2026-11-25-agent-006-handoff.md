---
id: artifacts/2026-11-25-agent-006-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-25
status: active
item: AGENT-006
state: done
brief: inline
base: c37fdba0
head: 5e0893a7
branch: feature/agent-006-campaign-context
pushed: true
stage: poc
suite_changed: false
gate: {result: pass, at: 2026-11-25T03:05Z}
next: {owner: main, action: "review PR #229 (/code-review: agent tool scoping + prompt-injection surface), then release = worker restart, and tick 最近的推廣 for tenants with a stored enabledTools"}
blockers: []
refs: [artifacts/2026-11-25-agent-006-campaign-context-impl, tests/2026-11-25-agent-006/ac3-README, github:229]
---
ac:
  AC-1: {result: pass, evidence: "red: tests/2026-11-25-agent-006/ac1-red.log (10 failed / 6 files); green: ac1-green.log (92/92); files agent-tools.test.ts, agent-campaigns-skill.test.ts, agent-skills.test.ts, agent-campaign-repository.test.ts, agent-schema-contract.test.ts, agent-config.test.ts"}
  AC-2: {result: pass, evidence: "tests/2026-11-25-agent-006/ac2-gate.log: tsc exit 0; vitest 728 files passed / 17 skipped, 8400 tests passed; no flaky re-run"}
  AC-3: {result: pass, evidence: "tests/2026-11-25-agent-006/ac3-README.md + ac3-walk-{1,2,3}.log + ac3-agent-messages.log: turn 1 toolCalls [get_recent_campaigns], stored reply quotes HK$880; turn 2 the past Sake Tasting '已…結束咗喇', not offered; the failed-status campaign excluded"}
  AC-4: {result: pass, evidence: "tests/2026-11-25-agent-006/ac4-zh-HK-desktop-1280.png, ac4-zh-HK-phone-390.png, ac4-checks.log (running app, real nav 設定 → 訂座及 AI 助理 → 進階設定)"}
  AC-5: {result: pass, evidence: "PR https://github.com/xavierau/omc/pull/229 into develop; ls-remote SHA == HEAD; kanban AGENT-006 in review, related kanban:AGENT-001, kanban:AGENT-005"}
decisions:
  - "The window and order use queued_at (NOT NULL), not sent_at (left null when a status webhook beats attachKapsoMessageId); idx_wa_messages_member_queued (080) serves it, so no migration [brief: no migration]"
  - "One row per campaign: the newest accepted row gives sentAt; the template is the newest non-null template_id of that campaign's sends, else campaigns.whatsapp_template_id (the coupon QR row has no template)"
  - "4 separate restaurant-scoped queries (member → sends → campaigns → templates), not embeds [memory principle_authorize_by_scoped_query]"
  - "The member lookup is copied into agent-campaign-repository (6 lines): extracting it from agent-tool-repository made an import cycle"
  - "AC-3 drove admit + processAgentReply with the production agentWorkerDeps; only the queue hop, the WhatsApp send and the booking proposal store (booking off) were replaced, so no shared Redis was touched"
failed:
  - tried: "shared findAgentMember exported from agent-tool-repository"
    why: "agent-tool-repository imports agent-campaign-repository to wire agentToolData → circular import"
    evidence: "reverted before commit"
    replaced_by: "local scoped member query in agent-campaign-repository"
invariants:
  - "get_recent_campaigns declaration has no parameters; the executor reads only ctx.key and ctx.now()"
  - "status filter is exactly sent|delivered|read"
  - "the campaigns skill text must not contain the string 'TABLE BOOKINGS' (AGENT-005 tests locate the booking section by that header)"
unverified:
  - "Prod data shape: campaign sends with template_id null AND campaigns.whatsapp_template_id null (text-mode campaigns) give templateText '' (owner: main, check Kushiro's campaigns use templates)"
  - "Quality of answers on real Kushiro template texts (only invented campaigns walked)"
review_focus:
  - "src/infrastructure/supabase/repositories/agent-campaign-repository.ts:31-90 query scoping and the per-campaign fold"
  - "src/application/agent/skills/campaigns-skill.ts rule wording (prompt injection, past events)"
  - "src/domain/value-objects/agent-config.ts DEFAULT_ENABLED_TOOLS now has 4 tools (default-on for new tenants)"
scope_drift:
  - "none committed. next dev rewrote CLAUDE.md (nextjs-agent-rules block) and supabase status bumped supabase/.temp/cli-latest; both restored with git checkout, not committed"
in_flight: []
next_step: "Review PR #229, then release by restarting the worker and ticking 最近的推廣 for omc/Kushiro."
