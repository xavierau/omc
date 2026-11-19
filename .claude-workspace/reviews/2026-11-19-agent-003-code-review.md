---
id: reviews/2026-11-19-agent-003-code-review
type: review
author: main
created: 2026-11-19
status: active
supersedes: null
superseded_by: null
related: [plans/2026-11-19-agent-003-agent-booking, threats/2026-11-19-agent-003-agent-booking, kanban:AGENT-003, github:195]
---

# Review: AGENT-003 PR #195 @ c75d682c (/code-review high)

Each finding verified by hand by main against the code at c75d682c (file:line read). Verdict: 9 CONFIRMED, 1 PLAUSIBLE (F6, needs a live API check). All go to fix round r4.

| ID | Sev | Where | Finding | Verified |
|---|---|---|---|---|
| F1 | important | application/agent/agent-booking-gate.ts:71 (`saveProposal`), process-agent-reply.ts:267 | A proposal is stored while the model runs; if that job's read-back is never sent (superseded by a newer inbound, failure → handoff/menu, window closed, claim lost), the next job still confirms it (`takeIfEarlier` only checks it came from an earlier job) and the WAITING line tells the model a read-back happened. Diner gets a booking/change/cancel they never saw. | CONFIRMED: saveProposal has no link to delivery; nothing deletes the proposal on a non-sent outcome. |
| F2 | important | agent-booking-change-tools.ts:229 | Shadow mode runs confirm_booking_cancel / confirm_booking_change for real (cancel texts the diner). Owner's OR5 acceptance covered CREATE in shadow only. | CONFIRMED: tools are mode-agnostic. |
| F3 | important | agent-booking-change-tools.ts:147,168,124; migration 085 RPC | After staff confirm a change, the confirmed row keeps `replaces_booking_id`; code treats any such row as an open change request → it can never be changed again, list labels it a change request. | CONFIRMED: RPC sets status confirmed, leaves replaces_booking_id; code tests `replacesBookingId` without status. |
| F4 | important | domain/value-objects/agent-config.ts:126 | Default `enabledTools` = all tools, incl. booking writes; a config blob without enabledTools or a new tenant saving the form gets write tools unchosen. | CONFIRMED (plan task 1 said "defaults include them"; main reverses that: write tools opt-in). |
| F5 | important | process-agent-reply.ts:267 | `offersProposal` ignores `propose_booking_cancel`, so a cancel-only tool set never gets the WAITING line and re-proposes on every "yes". | CONFIRMED. |
| F6 | important | infrastructure/gemini/agent-client.ts:310 | A mid-loop switch to the fallback model sends the primary model's functionCall parts with `thoughtSignature`; Gemini may 400, after a booking tool already ran. | PLAUSIBLE: `contents.push(step.content)` verbatim, sticky fallback can switch mid-loop; not run against the live API. |
| F7 | important | process-agent-reply.ts:174, 430-436 | Job error path: `respondToFailure` sends the handoff without claiming an agent row → no "Needs staff" flag; with config unread it defaults to handoff even for a `menu` tenant. | CONFIRMED. |
| F8 | nit | application/booking/decide-booking-request.ts:79; hooks/use-bookings.ts:124 | Declining a change request returns delivered:false by design, and the hook shows the "not delivered — contact the diner" badge. | CONFIRMED. |
| F9 | nit | agent-booking-change-tools.ts:237 | Cancel confirmation text goes out without the R11 disclosure (handoff path appends it). | CONFIRMED. |
| F10 | nit | infrastructure/supabase/repositories/booking-request-repository.ts:280, 322 | "Upcoming" filters on date ≥ today only; today's already-passed bookings can be listed, changed from or cancelled (R24 says past → refused). | CONFIRMED. |
