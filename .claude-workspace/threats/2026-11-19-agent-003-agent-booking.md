---
id: threats/2026-11-19-agent-003-agent-booking
type: threat-model
author: main
created: 2026-11-19
status: active
supersedes: null
superseded_by: null
related: [threats/2026-11-19-agent-001-ai-reply-agent, plans/2026-11-19-agent-003-agent-booking, kanban:AGENT-003]
---

# Threat Model: AGENT-003 AI agent takes bookings in WhatsApp + model fallback

Scope: the AGENT-001 reply agent gains (a) the first tools that WRITE: it proposes a table booking to the diner and, after the diner answers, creates a BOOK-001 **pending** booking request (staff confirm/decline in 訂座, existing templates notify the diner); (b) `get_booking_link` for tenants in booking mode `external`; (c) retry + fallback model on Gemini overload. Extends `threats/2026-11-19-agent-001-ai-reply-agent` (R1–R11 stay in force); this file only adds what changes.

## Assets
- A6 `booking_requests` rows (diner name, party, date/time, notes, phone): per tenant, PII.
- A7 The diner's WhatsApp inbox: a "received"/"confirmed" template for a booking they did not intend is a harm and a WhatsApp quality-rating risk (A3).
- A8 Staff attention in 訂座 (spam pending requests).

## Trust Boundaries
- TB4 (changed): model output now selects a WRITE. Model-supplied arguments (date, time, party size, name, notes) are untrusted input crossing into a domain write.

## STRIDE
- **Spoofing:** booking created for another phone/tenant → identity from the job only (R2 still binds; R12 below forbids any id/phone argument).
- **Tampering:** prompt injection ("book 20 tables", "party of 500", "notes: <script>") → R13 validation through BOOK-001's own `parseBookingSubmission` (maxPartySize, past dates, HH:MM, name/notes caps); R14 per-phone pending cap; notes rendered as text in the dashboard (existing).
- **Repudiation:** "I never asked for this booking" → R15 two-step gate (proposal shown in an earlier turn, diner message after it) and R17 provenance (booking marked as created by the AI agent, agent turn records the tool call by name + booking id).
- **Information disclosure:** the proposal echoes back only what the diner gave in this conversation; no lookup of other bookings (R12).
- **Denial of service:** a diner loops "yes" → R14 pending cap + AGENT-001 R6 rate limits; maxToolCalls stays the per-turn bound.
- **Elevation of privilege:** model calls `create_booking_request` without a proposal, or for a different booking than proposed → R15 (create takes NO arguments; it books exactly the stored proposal).

## OWASP Top 10 Coverage (applicable categories only)
- A01: R12. A03 / LLM01 prompt injection: R13, R15. A04 insecure design: R15, R16. LLM06 excessive agency: R15, R16, OR6.

## Secrets & PII
- No new secret. Booking PII goes into the existing `booking_requests` table under BOOK-001's retention purge (`/api/cron/booking-retention`). Proposal state (date/time/party/name/notes) is held server-side only for the confirmation window (≤30 min TTL) and never logged (AGENT-001 R8 applies to every new log line).
- PDPO: DPP1 purpose — the diner asked to book; met. DPP2 retention — BOOK-001 purge + proposal TTL; met. DPP3 use — booking only; met. DPP5 openness — the reply carries the R11 disclosure in auto; in shadow the diner sees nothing (OR5).

## Auth & Authz
- Unchanged: tools run in the worker bound to `{restaurantId, phone}` from the signed webhook job. `create_booking_request` / `propose_booking` are offered only when the tenant's `booking_config.mode = 'simple'` AND the tool is in `agent_config.enabledTools`; `get_booking_link` only when mode is `external`.

## Supply Chain (new deps + scanner / native-audit result)
- No new dependency planned. If one is added: scan_advisories.py + npm audit, exact pin ≥2 weeks old, recorded in the handoff.

## Required Mitigations
| ID | Mitigation | Test that proves it | Phase |
|---|---|---|---|
| R12 | Booking tool declarations carry no phone/restaurant/member/booking-id parameter; the executor uses the job key only. | Tool test: `propose_booking` args with injected `phone`/`restaurant_id` → stored proposal and created row carry the job's own restaurant + phone. | W1 |
| R13 | `propose_booking` validates args with BOOK-001's `parseBookingSubmission` (HK today, tenant `maxPartySize`, NAME_MAX/NOTES_MAX); invalid → tool returns the field errors, nothing stored. | Tests: party 0 / > max, past date, `25:00`, 61-char name → `{errors}`; no proposal stored. | W1 |
| R14 | Before insert, BOOK-001's per-phone pending cap (`MAX_PENDING_PER_PHONE`, counting BOOK-003 unverified too, as the page does) → over cap returns `too_many_pending`, nothing inserted. | Test: at cap → no insert, tool output reason. | W1 |
| R15 | Two-step gate: `create_booking_request` takes **no arguments** and books exactly the latest stored proposal for this `{restaurantId, phone}`, only if that proposal was made in an EARLIER job (its inbound row is older than this job's inbound row) and is < 30 min old and unused; it is consumed atomically (single use). | Tests: create with no proposal → `no_proposal`; create in the SAME job as propose → refused; expired → refused; second create → refused; happy path creates one row with the proposal's exact fields. | W1 |
| R16 | Created rows are BOOK-001 **pending** requests only (never confirmed); diner notification reuses BOOK-001's "received" template sender (best effort, never fails the booking). | Test: row status pending; sender called once with the received template. | W1 |
| R17 | Provenance: the booking is attributable to the AI agent (a source/created-by value or the agent turn's tool record carrying the booking id), visible to staff. | Test asserts the marker on the row or the agent row's tool record. | W1 |
| R18 | Overload resilience: on HTTP 429/5xx or timeout the client retries once with jitter, then tries the configured fallback model once, all inside the existing 20 s job budget; the logged `agent.reply` line carries the HTTP status code (no body text). | Client tests: 503 then 200 → ok; 503×2 then fallback 200 → ok with fallback model recorded; budget exhausted → `timeout`; log spy sees `httpStatus`. | W1 |

| R19 | Failure action (Xavier 2026-11-19 "the default behavior should escalate to staff"): knob `failureAction: 'handoff' \| 'menu'`, default `handoff`. In auto mode, when the agent fails (every AGENT-001 R4 failure class, incl. R18 budget exhausted), it sends ONE handoff reply: a short fixed apology + "staff will follow up" + the tenant's contact action (same source as `handoff_to_staff`), and the thread is flagged "needs staff" in `/dashboard/agent`. It does NOT write an `agent_silences` row (a transient failure must not mute the agent). `menu` keeps today's fallback menu. Still exactly one response per auto-admitted message (R4). Shadow mode unchanged. | Worker tests per failure class: handoff → one send with the contact action, no silence row, thread flagged; `menu` → today's fallback once. | W1 |

| R20 | Change/cancel scope (Xavier 2026-11-19: fold into AGENT-003). `list_my_bookings()` (no args) returns only the job phone's UPCOMING bookings at the job restaurant (pending + confirmed, date ≥ HK today), minimal fields (ref, date, time, party, status). | Tool test: another phone's / another tenant's / past bookings never returned; repo spy shows WHERE restaurant_id AND phone. | W1 |
| R21 | `propose_booking_change(bookingRef, date?, time?, partySize?)` and `propose_booking_cancel(bookingRef)`: the only id the model may pass is `bookingRef`, and it is resolved by a query scoped to the job's {restaurantId, phone} and upcoming status (principle: authorize by scoped query, never fetch-then-compare). New values validated by `parseBookingSubmission` (R13). This narrows R12 for these two tools only. | Tests: a ref belonging to another phone/tenant, a past or declined/cancelled booking → `not_found`, nothing stored. | W1 |
| R22 | Same two-step gate as R15 for `confirm_booking_change()` / `confirm_booking_cancel()` (no args; earlier-job proposal, ≤30 min, single use). One pending proposal per {restaurant, phone} across all kinds (a new proposal replaces the old). | Tests mirror AC-R15 for change and cancel. | W1 |
| R23 | Change = a change request linked to the original (staff decide in 訂座). The original booking stays valid until staff confirm; confirm atomically confirms the new time AND cancels the original (one transaction / RPC); decline leaves the original untouched and never tells the diner their original booking is declined. Diner gets BOOK-001 "confirmed" for the new time on confirm. 訂座 shows old → new. | Tests: decline → original unchanged + no 'declined' template about the original; confirm → original cancelled, new confirmed, single transaction (failure in the middle leaves both as before). | W1 |
| R24 | Cancel (diner-initiated, owner ruling: direct): after R22, an upcoming pending or confirmed booking becomes `cancelled` with `cancelled_by = diner_ai` (or equivalent marker), visible in 訂座; the diner gets a short in-window text confirmation (no template needed: the diner just messaged); reminder cron skips cancelled bookings. | Tests: status + marker set; reminder query excludes cancelled; text sent once; past booking → refused. | W1 |

## Open Risks & Acceptance (risks not mitigated, who owns acceptance)
- **OR5 Bookings created in shadow mode (owner: Xavier, accepted 2026-11-19).** Xavier chose "create anyway" in shadow after the consequence was spelled out: in shadow the proposal read-back is never sent to the diner, so the diner's next message satisfies R15 for a booking they never saw, and they receive the "received" template (and "confirmed" if staff approve). Accepted for the omc pilot; must be revisited before any second tenant uses shadow.
- **OR6 Model judges "yes" (owner: Xavier).** R15 proves the diner wrote after seeing the proposal, not that the message was an agreement; the model decides that. Bounded by pending status (staff confirm) and R14.
- AGENT-001 OR1–OR4 unchanged.

## Verdict: APPROVED
## Required Changes (if BLOCKED/CONDITIONAL)
- none
