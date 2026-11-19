---
id: artifacts/2026-11-19-agent-003-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-19
updated: 2026-11-19 (r2: rulings R18 knob, R19, R20–R24; r3: ruling 4 clock line on every reply)
status: active
item: AGENT-003
state: done
brief: inline (team-lead, AGENT-003 brief-v1 + rulings 1–4)
base: 7d4decf6
head: 5ba10669 (code + evidence; this file and the kanban entry are committed on top)
branch: feature/agent-003-agent-booking
pr: https://github.com/xavierau/omc/pull/195 (into develop, not merged)
pushed: true
stage: poc
suite_changed: true (only where a ruling changed behaviour; listed under AC-GATE r2)
gate: {result: pass, at: 2026-11-19T10:05Z}
next: {owner: main, action: "review PR #195; release = migration 085 FIRST, then worker restart; tick the booking tools for omc; decide maxOutputTokens default"}
blockers: []
refs: [plans/2026-11-19-agent-003-agent-booking, threats/2026-11-19-agent-003-agent-booking, threats/2026-11-19-agent-001-ai-reply-agent, kanban:AGENT-003]
---
# r3 (ruling 4)
- **AC-CLOCK: pass.** `vitest run -t AC-CLOCK`: 6 tests.
  - The line "CURRENT DATE AND TIME IN HONG KONG: YYYY-MM-DD (Weekday) HH:MM" is in the system instruction with booking off, simple and external, with maxToolCalls 0, and with an unreadable booking config.
  - It is computed per job from `deps.now()`: a job 5 h 30 min later shows 23:30.
  - `buildSystemInstruction(config, now, pending?)` now requires `now`. The pending-proposal line still needs a booking tool and a stored proposal.
  - Changed test: AC-MODE "off" now expects preamble + clock + knowledge. It was "no clock line", which ruling 4 reverses.
- **AC-GATE (r3): pass.** `resource-lock.py heavy -- bash -c 'npx tsc --noEmit && npx vitest run'` exited 0: 646 files, 7314 tests passed, 90 skipped. ESLint on the 3 files touched in r3 exits 0.

# r2 (rulings 1–3)

Evidence: `.claude-workspace/artifacts/2026-11-19-agent-003-evidence/r2/`. It has the walk logs `walk-r2-*.log`, `worker-agent-lines.log`, `kapso-capture.log`, `walk-r2-db.log`, `db-085.log`, `walk-r2-browser-{en,zh}.log` and screenshots with audit JSON in `shots/`. The tenant `A3 Test Cafe` and phone +85290000003 are fake. Nothing touched prod.

## ac (r2)
- **AC-R18 (ruling 1): pass.** `perCallTimeoutMs` defaults to 8000 and is clamped to 3000–15000. Attempts run primary, then fallback (sticky), then one primary retry only if the budget allows. The primary call reserves 5 s while the fallback is still unused.
  - Budget arithmetic tests (`agent-client.test.ts`): at the 8 s default the calls get [8000, 8000, 3600] ms. At 15 s: the primary gets 15000, the fallback gets 5000, and the primary is cut to 18000−5000.
  - The knob clamp is tested in `agent-failure-action.test.ts`.
- **AC-R19 (ruling 2): pass.** `vitest run -t AC-R19`, in `agent-failure-action.test.ts` and `agent-dashboard.test.tsx`.
  - In auto with `handoff`: each failure class (timeout, http, safety, parse, empty, tool_cap, truncated), config unreadable, and a job error each send ONE reply. The reply is the apology + "staff will follow up" + the contact action, with outcome `handoff`, and no silence row is written.
  - The thread gets `needsStaff`. A failed handoff send falls back to the menu.
  - `menu` keeps the old behaviour. Shadow, mode_off, silenced and rate-limited are unchanged.
  - Real DB: `handoff` claims the one reply per user row.
  - Walked: a truncated turn sent the apology and /dashboard/agent showed "Needs staff" / "需要職員跟進" (`shots/r2-agent-log-*`).
- **AC-R20: pass.** `list_my_bookings` returns only this phone's upcoming pending and confirmed bookings at this restaurant. Other phones, other tenants, past, declined and cancelled rows never come back.
  - The repository WHERE clause is asserted.
  - Refs are the shortest id prefix (at least 8) unique in the list. The walk found the shared-prefix case.
- **AC-R21: pass.** A ref for another phone, another tenant, a past, declined or cancelled booking, or a malformed or unknown ref → `not_found`, with nothing stored. New values go through `parseBookingSubmission`, and "no change" is refused.
- **AC-R22: pass.** Change and cancel both mirror R15: no proposal, the same job, expired, and single use. One proposal per conversation across kinds.
  - The Redis Lua checks the kind (`other_kind`) on a real Redis.
  - `peekKind` exposes the kind only. It drives a system line telling the model a read-back is waiting, and it consumes nothing.
- **AC-R23: pass.**
  - A change request is pending, linked to the original, with source `agent` and the original's name, notes and member; the original is untouched. A second change → `change_already_pending`.
  - Staff confirm → `confirm_booking_change` RPC: change confirmed, original `cancelled` / `change`, "confirmed" sent for the new time.
  - Decline → the original is unchanged and nothing is sent.
  - A failure in the swap rolls both rows back. This was checked in the fake and in real Postgres with a blocking trigger.
  - Rows that aren't change requests take the old path.
  - Walked: "我想將25號7點半嘅訂座改去26號8點" → read-back → "係" → pending change request. 訂座 Confirm → 26/11 confirmed, 25/11 "Replaced by a change" / "已改期取代". The diner got "你的訂座已確認… 2026-11-26 20:00".
- **AC-R24: pass.**
  - Upcoming pending or confirmed → `cancelled` / `diner_ai`, together with its open change request. The diner gets one bilingual text; a failed text doesn't undo the cancel.
  - A booking that became past or closed → `not_found`.
  - The reminder RPC excludes cancelled bookings, checked in real Postgres. The 085 CHECKs couple the status, the marker and `cancelled_at`.
  - Walked: "27號中午嗰個訂座我想取消" → read-back → "係，取消" → cancelled, with "已取消你 2026-11-27 12:30（2 位）的訂座。…" sent once. 訂座 shows "Cancelled by diner (AI agent)" / "顧客經 AI 助理取消".
- **AC-UI (r2): pass.** Advanced shows the failure action radios (handoff checked by default), the per-call timeout knob (min 3000, max 15000) and the five new tool checkboxes.
  - en and zh-HK at 1280 and 390, 0 blocking (`shots/r2-setup-advanced-*`).
  - 訂座 at 1280 and 390, en and zh-HK, 0 blocking (`shots/r2-bookings-*`).
  - Render tests are `booking-change-ui.test.tsx` and `agent-dashboard.test.tsx`. Testid registry rows were added.
- **AC-WALK (r2): pass.** Change, staff confirm and cancel as described above, with screenshots before and after the confirm.
- **AC-GATE (r2): pass.** `resource-lock.py heavy -- bash -c 'npx tsc --noEmit && npx vitest run && npx eslint src --quiet'`.
  - tsc: clean. vitest: 646 files, 7308 tests passed, 90 skipped, 0 failed.
  - ESLint: 36 errors, all in files this branch doesn't touch (for example `use-stamp-campaigns.ts` and `webhook-adapter.test.ts`). `eslint --quiet` on the 46 touched TS files exits 0.
  - No test was removed. Changed only where a ruling changed behaviour:
    - The default config gained `perCallTimeoutMs`, `failureAction` and the five tools.
    - AC-F3 now expects handoff, because the default is handoff.
    - The harness default `failureAction: 'menu'` keeps the AGENT-001 R4 tests.
    - The history query includes `handoff`.
    - The outcome CHECK and the one-reply index are read from 085.
    - The decided list includes `cancelled`.
    - The R2/R12 parameter tests allow `bookingRef`.
- **AC-PR: pass.** PR #195 retitled, with the body updated to put migration 085 before the deploy. Kanban was updated.

## decisions (r2)
- **R19 scope.** Model failures, budget, config unreadable and job errors all hand off. `send_failed`, `mode_off`, `silenced` and `rate_limited` keep the menu, because they are not agent failures. The handoff text goes into the model history, since the diner saw it.
- **Change = a new pending row with `replaces_booking_id`.** The confirm is atomic through a `SECURITY INVOKER` SQL function granted to service_role only. Decline uses the existing decide path, and `decided()` skips the "declined" message for a change request.
  - BOOK-003 shares `decideBookingRequest`, but rows with a null `replaces_booking_id` behave exactly as before: the RPC returns no row and `decide()` runs. So nothing needed escalating.
- **Cancel = one scoped UPDATE.** It is filtered by restaurant, phone, open status and date ≥ today, with `id = X or (replaces_booking_id = X and pending)`. It cancels the booking and its open change request together.
- **Pending-proposal system line.** On the confirm turn the model kept re-proposing, which restarts the gate and loops the diner. The cause: history keeps no tool results (R9). The worker now reads the proposal's kind (no values) and adds "WAITING FOR THE DINER … call <confirm tool> now". The gate itself is unchanged.
- **The 訂座 change line** reads the original's slot with one extra scoped `.in('id')` query per list load.

## unverified (r2)
- **Default `maxOutputTokens` 400.** It counts thoughts and text together. On booking turns it truncated 2 of 13 walk turns, and each became a handoff apology. The walk tenant ran at 1024 afterwards with no truncation. I didn't change the AGENT-001 default; that is main's call.
- **The local Supabase stack is still running** under my `supabase-whatsapp-crm` lock. A peer worktree (`whatsapp-crm--bookings-views`, next dev :3030; tenant "Cafe Poppy (BOOK-004 local)" seeded 09:34Z) is using it, so I didn't stop it.
  - To stop it: `touch /private/tmp/claude-501/-Users-xavierau-Code-js-whatsapp-crm/b7ce2348-be88-463f-a29e-8e4b78a7d232/scratchpad/a3/stop.sentinel`. That runs `supabase stop`, which keeps the data, and releases the lock.
- **The walk tenant's AGENT-001 per-phone hourly cap** (R6) rate-limited the 11th message in about 6 minutes. That is expected; the cap was raised to 60 for the walk.
- **No real-Gemini walk of a staff decline.** It is covered by the unit and real-DB tests.

## review_focus (r2)
- `supabase/migrations/085_agent_booking_changes.sql`: the constraints, the RPC and the index rebuild.
- `src/application/agent/agent-booking-change-tools.ts`: ref resolution and the confirm flows.
- `src/infrastructure/supabase/repositories/booking-request-repository.ts`: `cancelDinerBooking` (the `.or` filter) and `confirmBookingChange`.
- `src/application/booking/decide-booking-request.ts`: the change branch.
- `src/application/agent/process-agent-reply.ts`: `respondToFailure`, `fallBack` and `pending`.

# r1
## AGENT-003 handoff r1: the agent takes bookings + overload fallback (POC)

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
