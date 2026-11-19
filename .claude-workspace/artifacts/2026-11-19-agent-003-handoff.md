---
id: artifacts/2026-11-19-agent-003-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-19
status: active
item: AGENT-003
state: done
brief: inline (team-lead, AGENT-003 brief-v1)
base: 7d4decf6
head: b92e2aa5 (code + evidence; this file and the kanban entry are committed on top)
branch: feature/agent-003-agent-booking
pr: https://github.com/xavierau/omc/pull/195 (into develop, not merged)
pushed: true
stage: poc
suite_changed: false
gate: {result: pass, at: 2026-11-19T08:53Z}
next: {owner: main, action: "review PR #195; release = worker restart, no migration; tick the three booking tools for omc"}
blockers: []
refs: [plans/2026-11-19-agent-003-agent-booking, threats/2026-11-19-agent-003-agent-booking, threats/2026-11-19-agent-001-ai-reply-agent, kanban:AGENT-003]
---
# AGENT-003 handoff: the agent takes bookings + overload fallback (POC)

Evidence: `.claude-workspace/artifacts/2026-11-19-agent-003-evidence/`. It has the walk logs, `worker-agent-lines.log`, `kapso-capture.log`, `walk-db.log`, screenshots with audit JSON in `shots/`, and the walk scripts in `tools/`. All data is fake: tenant `A3 Test Cafe` and phones +85290000003/4. Nothing touched prod.

## ac
- **AC-R12: pass.** `vitest run -t AC-R12`: 3 tests.
  - Injected `phone`, `restaurant_id`, `restaurantId`, `member_id` and `booking_id` are dropped. The proposal key and the row use the job's restaurant and phone.
  - No declaration has an identity parameter. `propose_booking` takes only date, time, partySize, name and notes.
- **AC-R13: pass.** 6 tests.
  - Each of these returns `{error:'invalid', fields}` and stores nothing: party 0, a party above maxPartySize, a past date, `25:00`, a 61-char name, and today at a time already past. A following create returns `no_proposal`.
- **AC-R14: pass.** 2 tests.
  - Pending plus live BOOK-003 unverified at `MAX_PENDING_PER_PHONE` → `too_many_pending` at propose.
  - The cap reached between propose and create → `too_many_pending`, and no agent row is written.
- **AC-R15: pass.** 7 tests, plus 2 real-Redis tests.
  - Refused: no proposal; propose and create in the same job (the proposal stays for the next message); a job older than the proposing one; an expired proposal (30 min); a second create.
  - Happy path: exactly one row with the proposal's fields (notes trimmed, member linked). A newer proposal replaces the old one.
  - The Lua take-if-earlier was run against a real Redis 8: two concurrent takes give exactly one `taken`, microsecond timestamps compare correctly, and the TTL expires. Command: `RUN_REDIS_TESTS=1 REDIS_TEST_URL=redis://127.0.0.1:6402 npx vitest run src/infrastructure/redis`. It is skipped without that env.
- **AC-R16: pass.** 2 tests. The row status is `pending` and the received message is sent once with the restaurant name and details. A send that is not delivered, or one that throws, still returns `booked`.
- **AC-R17: pass.** 5 tests.
  - The row has `source: 'agent'`.
  - A worker run in both auto and shadow creates one pending agent row. The agent rows' `tool_calls` are `[propose_booking]` and `[create_booking_request]`.
- **AC-R18: pass.** 11 tests.
  - Client:
    - 503 then 200 → ok on the same model after one 400 ms pause.
    - 503, 503 → the fallback model answers and is named in the result. The fallback stays for the rest of the tool loop.
    - 429 is retried. A timeout is retried. A 400 is not.
    - With no fallback, or a fallback equal to the main model, it retries once only.
    - Budget exhausted → `timeout` with no third call.
  - Worker: resolution goes tenant → env → `gemini-3.5-flash-lite`, and a bad id falls back to the default. The row records the model that answered. `agent.reply` carries `httpStatus` (200 / 503) and no text or phone.
- **AC-MODE: pass.** 9 tests.
  - off or unreadable → no booking tool. simple → propose and create. external → `get_booking_link` only, returning externalUrl.
  - Always gated by enabledTools. A call to a tool the mode does not offer → `tool_not_available`.
  - The clock line appears only when propose is offered. If the booking config read throws, the reply still goes out.
- **AC-GATE: pass.**
  - `python3 ~/.claude/bin/resource-lock.py heavy -- bash -c 'npx tsc --noEmit && npx vitest run'` exited 0: 643 files passed, 12 skipped; 7243 tests passed, 81 skipped (scratchpad `gate.log`).
  - No test was removed. Existing tests changed only where a fixed item changed behaviour:
    - The default-config expectation gained `fallbackModel` and the three tools.
    - The AGENT-001 "no parameters" test now excludes `propose_booking`; AC-R12 covers it instead.
    - The client toEqual gained `model` and `httpStatus`.
    - The test request helpers gained `fallbackModel: null`, `booking: null` and the new fake ports.
    - The `FakeBookingRequests` token clash now ignores NULL, matching the UNIQUE index.
- **AC-UI: pass** (screenshots).
  - At `/dashboard/setup` → AI agent → Advanced: the fallback model field and the three tool checkboxes, all checked by default, in en and zh-HK at 1280 and 390. Shots: `shots/setup-advanced-{en,zh}-{1280,390}.png`.
  - Layout audit: 0 blocking. The warnings are native checkbox touch targets and one spacing item, the same set as AGENT-001.
  - Render test `agent-dashboard.test.tsx` checks the field, the checkboxes, the en and zh-HK keys, and the payload (blank → null, trimmed).
  - The testid registry row was added.
- **AC-WALK: pass** (log). Setup: local Supabase, `next dev` plus the real `scripts/start-worker.ts`, Kapso intercepted, Gemini `gemini-3.5-flash-lite` on the `.env.local` key.
  - "我想訂枱，聽日7點4位，陳生" → `propose_booking`. The reply reads it back with the date resolved to 2026-11-20 and asks for confirmation.
  - "好" → `create_booking_request` → one `pending`, `source agent` row: 陳生, 4 people, 2026-11-20 19:00, member linked (`walk-db.log`). The received text went out (`kapso-capture.log`).
  - 訂座 shows the row with "via AI agent" / "經 AI 助理" (`shots/bookings-{en,zh}-1280.png`). `/dashboard/agent` lists the tool names under each agent row (`walk-browser-en.log`, `shots/agent-log-en-1280.png`).
  - Every log line carries `httpStatus: 200`.
- **AC-PR: pass.** PR #195 into develop, not merged. The kanban AGENT-003 entry is in `review`, linking the plan, the threat model and this file.

## decisions
- **R17 provenance reuses `source = 'agent'`; no migration 085.**
  - Why: 訂座 already shows "via AI agent" / "經 AI 助理" for it.
  - Safety: our rows have status `pending`, a null `status_token_hash` and a null `idempotency_key`, so the BOOK-003 paths never match them. Status read needs a token hash, replay needs an idempotency key, and promote and purge touch `unverified` only.
  - Cost: staff can't tell a WhatsApp-agent booking from a personal-agent (poppy) one. That is the main's call if it matters.
- **The R15 "earlier job" check** compares the `created_at` of the proposing job's inbound `agent_messages` row with the current job's. The current job's time comes from the new port method `AgentMessageStore.userMessageCreatedAt(key, id)`, scoped by restaurant, phone and role. It is stored as epoch ms in a Redis hash.
  - An equal or later timestamp → `not_earlier`, and the proposal is kept.
  - The Lua script does the check and the delete in one step.
- **The cap (R14) is checked at propose and again at create.**
- **The proposal is re-validated at create** with the current time, so a time that passed during the 30 minutes is refused.
- **R18 allows one retry and one fallback per run, not per call.** After the switch the run stays on the fallback model.
  - Risk: the history may carry the primary model's thought signatures. If the fallback rejects them, the result is an `http` failure and the diner gets the fallback menu.
  - `httpStatus` is the status of the last HTTP response. `model` is not added to the log line, because the AC-R8 log-key test pins the key set; the row records the model instead.
- **The booking config is read only when a booking tool is enabled.** A read error means no booking tools for that run.
- **`propose_booking` description**: "reserves nothing (never say a table is held)". The first walk's read-back said 暫時保留 (temporarily held), which implied a held table. After the fix the next read-back was "幫你預訂 … 請問資料正確嗎？" (`walk-03.log`).

## failed
- none

## invariants
- `create_booking_request` stays argument-free.
- Booking tools are offered only by booking mode AND enabledTools.
- Agent rows are `pending` with source `agent` and no token.
- Proposal values are never logged.

## unverified
- **The R18 fallback mid-tool-loop with foreign thought signatures, on real Gemini.** It was unit-tested only. Owner: prod smoke or observation (`agent.reply` httpStatus plus model on the row).
- **OR5 (shadow creates bookings)** was unit-tested in shadow, not walked. Accepted by the owner.
- **omc's stored `enabledTools`.** If omc saved settings before, the three new tools are off until ticked: the owner or main must tick them. That is a deploy step, recorded in the PR body.
- **Local DB volume.** The local `whatsapp-crm` Supabase DB was the BOOK-003 walk's (fake data only, `admin@book003.test`). I applied 083_agent_reply to it by hand: its migration table listed BOOK-003's old `083_agent_booking`. When I stopped the stack, a docker prune was already running on the machine, and afterwards no supabase volume was listed. The fake data may be gone. The next `supabase start` rebuilds from migrations.
- **poc-log.md** is not in files_allowed and was not written. Main may append: "2026-11-19 · AGENT-003 agent takes bookings on omc · question: will diners book by chatting and do the pending requests match · PR #195 · outcome: pending".

## review_focus
- `src/application/agent/agent-booking-tools.ts`: the create flow order, which is take, then re-validate, then cap, then insert, then notify.
- `src/infrastructure/redis/agent-proposal-store.ts`: the Lua script and the MULTI save.
- `src/infrastructure/gemini/agent-client.ts` `callResilient`: retry, fallback and budget.
- `src/application/agent/process-agent-reply.ts` `bookingContext`, and the `base.model` taken from the result.

## scope_drift
- `src/test-utils/fake-booking.ts` (under `src/**`, allowed): the NULL-token clash fix.

next_step: "Main: review PR #195, then release by restarting the worker (no migration) and ticking the booking tools for omc."
