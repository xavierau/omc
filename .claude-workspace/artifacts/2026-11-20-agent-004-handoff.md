---
id: artifacts/2026-11-20-agent-004-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-20
status: active
item: AGENT-004
state: done
brief: inline (main, AGENT-004 brief-v1; resume note: base the PR on current origin/develop)
base: 15fb61ef (origin/develop; brief base 275785f2, rebased; 275785f2..15fb61ef touches none of the AGENT-004 files)
head: 6ac3e4c8 (code; this file, the journal and the kanban entry are committed on top)
branch: fix/agent-004-classifier-skip-when-agent-books
pr: https://github.com/xavierau/omc/pull/204 (into develop, not merged)
pushed: true
stage: poc
suite_changed: false
gate: {result: pass, at: 2026-11-20T00:47Z}
next: {owner: main, action: "review PR #204; merge into develop and release with the owner; no migration, the web app restart is enough (the webhook code changed, the worker did not)"}
blockers: []
refs: [kanban:AGENT-004, kanban:AGENT-003, kanban:BOOK-001, github:204]
---
ac:
  AC-1: {result: pass, evidence: "agent-routing.test.ts: 'AGENT-004 ...' describe, 13 cases a–f + retry; red first in f59e2568 (4 failed), green in 6ac3e4c8; 65/65 in the two files, also after the rebase"}
  AC-2: {result: pass, evidence: "resource-lock heavy -- bash -c 'npx tsc --noEmit && npx vitest run' exit 0 on the pre-rebase tree: 652 files, 7464 passed, 94 skipped. After rebasing onto 15fb61ef: tsc exit 0 and the touched files 65/65 (no full re-run; CI runs it)"}
  AC-3: {result: pass, evidence: "https://github.com/xavierau/omc/pull/204; the CI state is in the return block"}
  AC-4: {result: pass, evidence: "debugging_journals/2026-11-20-agent-004-classifier-preempts-agent.md; .claude/kanban.json review → AGENT-004 (pr 204)"}
decisions:
  - "Predicate agentOffersBookingTools lives in src/application/agent/agent-tools.ts next to offeredTools and calls it, so the webhook and the worker share one rule [brief fixed 1]"
  - "maxToolCalls 0 counts as no booking tool, because the worker sends no tool declarations then (process-agent-reply.ts callModel). Without this the agent would own booking text it cannot act on. The brief did not name this case; covered by test (b)"
  - "The config reads are not shared with admitInboundForAgent: admit runs a second single-column read after the predicate. Both reads (agent_config + booking_config) run in parallel, so they add one round-trip to unmatched text. Chosen for simplicity [decide_yourself]"
  - "The booking config is read through inboundBookingDeps(log).getConfig, the classifier's own source, and the agent config through admitAgentDeps(log).getConfig, admit's own source"
  - "Non-text messages never take the skip (the webhook adapter checks), so their routing is exactly as before"
  - "Test text is neutral, not the prod message (public repo)"
failed: []
invariants:
  - "Skip only when agent mode is auto AND offeredTools(enabledTools, bookingMode, 'auto') has a booking tool AND maxToolCalls > 0; any read error → classifier first"
  - "The BOOK / BOOKING / 訂位 / 訂枱 keyword route never consults the predicate"
unverified:
  - "Not exercised against a real Supabase / WhatsApp. Routing is proven through routeMessage with fakes. A live check on omc after release (owner): reply to the agent's 'which booking?' question and see an agent_messages user row and no CTA — owner/main"
  - "CI result at hand-off: see the return block"
  - "No poc-log entry: .claude-workspace/poc-log.md is outside files_allowed — main"
review_focus:
  - "src/app/api/webhooks/whatsapp/handlers.ts dispatchConfirmation: the new short-circuit order"
  - "src/application/agent/agent-owns-booking-text.ts: the fall-open catch"
  - "A side effect to accept or reject: in auto with booking tools, a phone silenced by a handoff (or over its rate limit) now gets the fallback menu for booking-sounding text, where before it got the classifier's CTA"
scope_drift:
  - "src/app/api/webhooks/whatsapp/__tests__/book-routing.test.ts: setup now mocks agent-config-repository (agent off), because the predicate reads agent_config before the classifier and W2-06 asserts no DB client. Assertions unchanged. Inside files_allowed"
in_flight: []
next_step: "Review and merge PR #204 into develop, then release with the owner and run the live omc check."
