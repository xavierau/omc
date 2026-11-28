---
id: artifacts/2026-11-19-book-003-dev-handoff
type: handoff
contract: handoff-file-v1
author: dev (book-003-dev)
created: 2026-11-19
status: active
item: BOOK-003
state: done
brief: inline (team-lead dispatch 2026-11-19)
base: 7642764cb5
head: 32ac53d4
branch: feature/book-003-agent-booking
pushed: true
stage: poc
suite_changed: false
gate: {result: pass, at: 2026-11-19T03:00Z}
next: {owner: none, action: "POC: owner review of the PR into develop; release + real-agent run need owner go"}
blockers: []
refs: [artifacts/2026-11-19-book-003-agent-booking-impl, threats/2026-11-19-agent-booking-poppy, plans/2026-11-19-agent-booking-poppy]
---
ac:
  AC-1: {result: pass, evidence: "evidence/2026-11-19-book-003/ac1-validator.log: PAP kit validator --file, 7 passed 0 failed, exit 0, on the poppy.json downloaded from the admin route"}
  AC-2: {result: pass, evidence: "evidence/2026-11-19-book-003/ac2-openapi-lint.log: npx @redocly/cli@1.25.11 lint (minimal) valid, 0 warnings, exit 0"}
  AC-3: {result: pass, evidence: "evidence/2026-11-19-book-003/ac3-curl.log: local next dev + local Supabase 001..082 + this migration; 202 with every field, row unverified/agent, no send, GET token 200 awaiting_confirmation, no token 404"}
  AC-4: {result: pass, evidence: "src/app/api/webhooks/whatsapp/__tests__/booking-confirm-code.test.ts 12/12 through routeMessage"}
  AC-5: {result: pass, evidence: "agent-booking-lifecycle.test.ts 3/3; agent-booking.db.test.ts 9/9 on 084 (8/9 red without), re-run after the rename; local stack: staff Confirm then GET → confirmed (ac3-curl.log tail)"}
  AC-6: {result: pass, evidence: "R-id → test table in the impl artifact; full vitest 626 files / 6935 tests pass under heavy lock; tsc exit 0; eslint on changed files 0 problems"}
  AC-7: {result: pass, evidence: "evidence/2026-11-19-book-003/ac7-settings-agent-on-1280.png, ac7-bookings-via-agent-1280.png; seeded on local Supabase (DEV DB lacks 082 and this migration)"}
  AC-8: {result: pass, evidence: "branch pushed, ls-remote SHA == HEAD; PR into develop (URL in the return block / PR list)"}
decisions:
  - "migration renumbered 083 → 084 — team-lead ruling 2026-11-19, AGENT-001 PR #185 owns 083"
  - "snake_case API fields — the brief's response contract is snake_case"
  - "confirm code needs a digit; matching case-insensitive; ≤3 candidates — keeps the webhook lookup to code-shaped texts (plan perf budget)"
  - "check runs in dispatchRoute before resolveRoute — 'first for inbound text … before receipt/YES/NO' [brief fixed]; also beats BOOK"
  - "Idempotency-Key older than 24 h → 409 — the unique index keeps the key on verified rows"
  - "agent bookings keep member_id null — R42 forbids touching members; sender resolves language by phone"
  - "collection statement adds 'phone number' — this API collects the phone (BOOK-001 page did not)"
failed:
  - tried: "chrome-devtools MCP screenshot straight into the worktree"
    why: "MCP writes only inside its configured roots (main checkout)"
    evidence: "Access denied error"
    replaced_by: "save under the main checkout root, then mv into the worktree evidence folder"
invariants:
  - "Restaurant for the agent API comes only from booking_config.agentBooking.publicId (path); re-checked against the stored config"
  - "Promotion is one conditional UPDATE bound to the webhook sender phone; send only for rows it returned"
  - "Staff paths never see status unverified (list filters, findForRestaurant neq, decide on pending, reminder RPC on confirmed)"
  - "Only the SHA-256 of the status token is stored; tokens/codes/PII never logged"
unverified:
  - "Real Kapso webhook delivering a code (local run promoted via the repository's UPDATE as SQL) — owner: release I-task"
  - "A real personal agent reading a poppy.json on a real restaurant domain — owner: Xavier (POC learn-question, needs release + test domain)"
  - "R45 privacy-policy copy — owner: Xavier before go-live"
review_focus:
  - "src/app/api/webhooks/whatsapp/handlers.ts: confirm-code check placement before resolveRoute"
  - "src/application/booking/create-agent-booking.ts: replay/idempotency and cap ordering"
  - "supabase/migrations/084_agent_booking.sql: constraint drop/re-add names (082 inline CHECK names)"
scope_drift:
  - "src/messages/en.json, zh-HK.json — brief's messages/** names the i18n files; the repo keeps them under src/messages"
in_flight: []
next_step: "Owner reviews the PR (migration is 084 per team-lead ruling; agent-001 owns 083)."
