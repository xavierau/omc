---
id: plans/2026-11-19-agent-001-ai-reply-agent
type: plan
author: main
created: 2026-11-19
status: active
supersedes: null
superseded_by: null
related: [threats/2026-11-19-agent-001-ai-reply-agent, kanban:AGENT-001]
---

# Plan: AGENT-001 AI reply agent (POC)

## Objective
Learn-question: for a pilot HK restaurant, are Gemini agent replies to diners' free-text questions good enough (graded in shadow) to switch on auto-send — and which knobs matter? Seen by: the restaurant owner in the dashboard conversation log, then diners on WhatsApp.

## Context (files, constraints, dependencies)
- Stage POC. Base `origin/develop` (BOOK-001 is on develop, not yet released; this branch ships after it).
- Hook point: `src/app/api/webhooks/whatsapp/handlers.ts:195-197` (after `maybeReplyToBookingIntent`, before `handleUnknown`). Webhook is synchronous → agent runs in a new BullMQ worker (pattern: `src/infrastructure/queue/receipt-queue.ts`, registered in `scripts/start-worker.ts`).
- Config pattern: JSONB on `restaurants` + value object with never-throwing resolver + CAS repo + admin route (copy `booking_config`: `082_booking.sql:19-31`, `domain/value-objects/booking-config.ts`, `booking-config-repository.ts`, `api/dashboard/settings/booking/route.ts`, `BookingSettingsSection`).
- Gemini: REST `v1beta/models/<model>:generateContent` with `systemInstruction`, `contents`, `tools.functionDeclarations`, `generationConfig`; `functionResponse` must echo the call `id` + `name`. Key header `x-goog-api-key` (copy `decisions-client.ts`). No new dependency.
- Send: `sendTextMessage` (SendResult, never throws); check `isWindowOpen` before an auto send.
- Next migration: 083. Threats: `threats/2026-11-19-agent-001-ai-reply-agent` (R1–R11).

## Domain Model (entities, VOs, aggregates)
- VO `AgentConfig` (JSONB `restaurants.agent_config`, default `{"mode":"off"}`), the knobs: `mode: off|shadow|auto` · `model` (default from env `AGENT_MODEL`, fallback `gemini-3.8-flash`, dev verifies the id against the key's models list) · `knowledge` (owner's restaurant info text, ≤8k chars) · `instructions` (tone/persona, ≤2k) · `temperature` (0.3) · `maxOutputTokens` (400) · `maxReplyChars` (600) · `maxHistoryMessages` (10) · `historyTtlHours` (72) · `debounceMs` (3000) · `maxToolCalls` (3) · `enabledTools` (`['get_member_summary','list_rewards','handoff_to_staff']`) · `handoffSilenceHours` (12) · `maxRepliesPerPhonePerHour` (10) · `maxRepliesPerTenantPerDay` (500) · `disclosureText` (R11) · `rev`. Resolver clamps every number to a safe range and never throws.
- Entity `AgentMessage` (table `agent_messages`): restaurant_id, phone, role `user|model`, text, wamid (unique per restaurant for user rows), outcome (R9), model, latency_ms, tool_calls (names only), created_at. RLS on, no client policies.
- Port `AgentModelPort.respond(input) → Result` (ok text | failure reason: timeout/http/safety/parse/empty/tool_cap) — follow the `SendResult`/`ClassifyResult` precedent, never `T|null`.
- Silence: `handoff_to_staff` writes a `silenced_until` (in `conversation_windows` or a small `agent_silences` table — dev picks the lesser change, documents it).

## Subtasks (POC task list)
1. **W1 backend (dev)** — migration 083 (`agent_config` column + `agent_messages` table + RLS + indexes); `AgentConfig` VO + repo; `AgentModelPort` + Gemini REST adapter with tool loop (≤`maxToolCalls`) and hard timeout; tools bound to job `{restaurantId, phone}` (R2, R3); `agent-reply` queue + worker (debounce/latest-wins, rate limits, shadow vs auto, fallback on failure, disclosure, trimming: R4, R6, R10, R11); webhook hook at `handlers.ts:195-197` storing the user row + enqueue (R1; shadow still calls `handleUnknown`, auto skips it unless silenced/over-limit); retention purge as a BullMQ job scheduler in the worker (R5); no-PII logs (R8). Kanban AGENT-001 entry. Covers R1–R6, R8–R11.
2. **W2 dashboard + I-task (dev)** — `GET/PUT /api/dashboard/settings/agent` (admin PUT, R7); `AgentSettingsSection` on `dashboard/setup` (mode, knowledge, instructions, the numeric knobs under an "Advanced" disclosure); `/dashboard/agent` conversation log (admin only, scoped, last 7 days by phone-masked thread: diner message → draft/sent reply + outcome) with nav entry; i18n keys (en + zh-HK); test ids per frontend-testing rule. I-task: walk inbound text → shadow draft visible in the log → switch to auto → reply received, on local stack with a mocked Kapso send + real Gemini call. Covers R7 + end-to-end.

## Integration Map
worker registration in `scripts/start-worker.ts` (W1) · queue module (W1) · webhook hook point (W1) · env `AGENT_MODEL` in `.env.example` (W1) · settings route + setup page section (W2) · nav entry + `/dashboard/agent` route (W2) · i18n en/zh-HK (W2) · testid registry (W2) · deploy note: worker daemon restart already covers new queue (W2 checks `deploy.sh`).

## Acceptance Criteria
- evidence: with mode `shadow` on the local stack, a free-text message produces a stored draft visible at `/dashboard/agent`, and the diner still gets the fallback menu (screenshot + log).
- evidence: with mode `auto`, the same message gets the agent's reply (with disclosure) and no fallback menu; a Gemini failure gives the fallback menu.
- evidence: a question about points answers with the sender's own points (tool call recorded by name).
- Every R-id in the threat model has its named test passing.

## Performance Budgets
- Webhook added latency ≤ 50 ms p95 (one insert + one enqueue; no LLM call — R1).
- Agent reply sent ≤ 10 s p95 after debounce (Gemini timeout 8 s per call, ≤ `maxToolCalls`+1 calls, overall job budget 20 s → fallback).

## Out of Scope
Staff-reply (echo) detection (AGENT-002) · conversational booking · write tools (redeem, award) · image/voice input · per-message human approval inbox · multi-provider · eval harness beyond the shadow log · DSAR delete-by-phone UI.

## Risks & Open Questions
- OR1–OR4 in the threat model (billing tier, hallucinated promises, pilot consent, staff collision).
- Pilot tenant not yet named; mode is set per tenant in the settings UI, so the code doesn't need it.
- Model id: context7 docs show `gemini-3.8-flash`/`gemini-3.5-flash`; receipts use `gemini-3.1-flash-lite-preview`. Dev verifies with `GET v1beta/models` and makes it the env default.
