---
id: plans/2026-11-19-agent-003-agent-booking
type: plan
author: main
created: 2026-11-19
status: active
supersedes: null
superseded_by: null
related: [threats/2026-11-19-agent-003-agent-booking, plans/2026-11-19-agent-001-ai-reply-agent, kanban:AGENT-003]
---

# Plan: AGENT-003 AI agent takes bookings in WhatsApp + model fallback (POC)

Learn-question: will diners book a table by chatting with the omc agent (auto), and do the pending requests staff see in 訂座 match what the diner asked for? Seen by Xavier on omc's number and in 訂座.

Owner rulings 2026-11-19: agent creates a BOOK-001 **pending** request (staff confirm); shadow mode creates it too (OR5 accepted); booking-link tool for external mode ("2y"); overload retry + fallback model (default yes).

Tasks (one `dev`, one branch, threat R12–R18):
1. Domain: `AGENT_TOOL_NAMES` += `propose_booking`, `create_booking_request`, `get_booking_link`; defaults include them; `AgentConfig.fallbackModel` (nullable, same id pattern; env `AGENT_FALLBACK_MODEL` → default `gemini-3.5-flash-lite`).
2. Tools (agent-tools.ts): `propose_booking(date,time,partySize,name,notes?)` validates via `parseBookingSubmission` (R13) and stores the proposal (Redis, TTL 30 min, keyed restaurant+phone, with the proposing job's inbound row time) → returns a read-back summary; `create_booking_request()` no args, books the stored proposal under R15, R14 cap, pending + received template (R16), provenance (R17); `get_booking_link()` returns the external URL (external mode only). Offer booking tools only per booking mode (threat Auth & Authz).
3. Prompt rule 6 rewritten: collect date, time, party size, name; call propose_booking; read the summary back and ask the diner to confirm; call create_booking_request only after the diner agrees in a later message; handoff only when the diner asks or rule 3 applies.
4. Client (agent-client.ts): R18 retry once on 429/5xx/timeout, then fallback model once, inside the job budget; log `httpStatus`; record the model actually used on the agent row.
5. Wiring: dashboard Advanced → fallback model field + the 3 tool checkboxes (en + zh-HK i18n, test ids); conversation log shows booking tool calls by name.
6. Evidence: local stack walk (mocked Kapso, real Gemini on a lite model): chat "我想訂枱，聽日7點4位，陳生" → proposal read-back → "好" → pending row visible in 訂座 with the agent marker.

7. (Ruling 2026-11-19, folded in) Change + cancel by chat — threat R20–R24: tools `list_my_bookings`, `propose_booking_change`, `confirm_booking_change`, `propose_booking_cancel`, `confirm_booking_cancel` (simple mode only, behind enabledTools); change request linked to the original, staff confirm/decline in 訂座 (old → new shown), confirm swaps atomically; cancel is direct with a diner-AI marker and an in-window text. Migration 085 if the schema needs a link column / cancelled status. Failure action R19: default handoff reply + "needs staff" flag, no silence. Per-call timeout knob (R18).
8. Evidence additions: change 25/11 19:30 → 26/11 20:00 walked to a change request in 訂座 and confirmed (original cancelled); cancel walked to cancelled with the marker.

Wiring list: agent-config VO + resolver, agent-tools, agent-prompt, agent-client, process-agent-reply (tool context gets booking deps + mode), settings route/UI/i18n, testid registry, `.env.example` (`AGENT_FALLBACK_MODEL`).
Out of scope: confirmed bookings, availability/capacity, editing or cancelling bookings by chat, booking in BOOK-003 unverified flow.
