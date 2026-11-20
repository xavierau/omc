---
id: threats/2026-11-20-book-007-008-member-bookings
type: threat
author: main
created: 2026-11-20
status: active
supersedes: null
superseded_by: null
related: [kanban:BOOK-007, kanban:BOOK-008, threats/2026-11-19-agent-003-agent-booking, threats/2026-11-19-agent-booking-poppy, kanban:BOOK-006]
---

# Threat Model: booking no-show status (BOOK-007) and member ↔ booking linking (BOOK-008)

Owner rulings 2026-11-20: bookings link to an existing member by phone by default; staff can edit the
link by hand (link to another member, or unlink); the member panel shows the member's bookings and booking
stats; the diner name on a booking opens the member panel; a new `no_show` status that staff set.
Stage POC. Repo `xavierau/omc` is public: no prod names, phones or message text in code, tests or records.

## Assets
- Booking rows (`booking_requests`): name, phone, notes (PII until the 180-day purge, BOOK-001 R19), status.
- The member ↔ booking association (`booking_requests.member_id`): tells staff "this person booked / did
  not show"; feeds member stats.
- Member profile (`members`) and its detail panel.
- No-show history: a negative mark about a person.

## Trust Boundaries
- Staff browser → dashboard API (session + tenant context; roles `admin`, `staff`).
- Webhook / agent worker / poppy API → booking creation (diner-controlled phone; poppy phone unverified until
  the confirm code, R31/R32 of the poppy model).
- Tenant boundary: every booking and member belongs to one restaurant; the service-role client bypasses RLS,
  so app-level scoping is the only guard.

## STRIDE
- **Spoofing.** A poppy booking's phone is unproven until verified; auto-linking it would attach someone's
  booking (and later a no-show) to another person's member record → R1. Staff identity comes from the session.
- **Tampering.** Manual relink with a member id from another tenant, or a booking id from another tenant → R2.
  Marking a no-show on a future, pending, declined or cancelled booking → R5.
- **Repudiation.** Who linked/unlinked a booking and who marked a no-show must be recorded → R4, R6.
- **Information disclosure.**
  - Member panel bookings listed across tenants → R2.
  - A wrong link must not route messages or agent answers to the wrong person: reminders/decision messages go
    to `booking.phone`, and the agent's `list_my_bookings` and diner paths scope by phone, never by member → R3.
- **Denial of service.** Member panel loads all bookings of a heavy member: cap the list → R8.
- **Elevation of privilege.** Relink and no-show are staff actions like confirm/decline (admin and staff); no
  new role. Diner-facing and agent surfaces gain no write path to `member_id` or `no_show` → R7.

## OWASP Top 10 Coverage (applicable categories only)
- A01 Broken access control: tenant-scoped queries for every read and write (R2); no diner/agent write path (R7).
- A03 Injection: ids are UUID-validated and bound as parameters; the member search for relink reuses the
  existing members lookup route (R2).
- A04 Insecure design: unverified-phone auto-link (R1); no-show state machine (R5).
- A09 Logging: audit rows with actor and ids only, no names/phones in logs (R4, R6).

## Secrets & PII
No new secret. PDPO (Cap. 486):
- DPP1 purpose: booking handling and the restaurant's customer relationship; linking an EXISTING member by
  the phone the diner gave is within the BOOK-001 R21 precedent. No member is ever created from a booking (R1).
- DPP2 accuracy and retention: wrong auto-links are fixable by staff (manual edit); the BOOK-001 R19 purge
  (name/notes after 180 days) is unchanged and must also cover `no_show` rows (R9). Stats use status/dates only,
  which survive the purge by design.
- DPP3 use: the no-show mark and stats are shown to staff for booking handling. Using them for campaign
  targeting or segmentation is a new use, out of scope here → Open Risks.
- DPP4 security: R2, R3, R7.
- DPP5 openness: no change to diner-facing copy; noted under Open Risks.
- DPP6 access/correction: staff can correct a link and undo a no-show (R5).
- Part 6A direct marketing: not touched (no consent row, no opt-in change) (R1).
- Cross-border: no new transfer.

## Auth & Authz
- All new routes use `getTenantContext()`; role in (`admin`, `staff`), as decide/delete do.
- Authorize by scoped query (memory principle_authorize_by_scoped_query): the update `WHERE id = $booking AND
  restaurant_id = $tenant`, and the target member resolved `WHERE id = $member AND restaurant_id = $tenant`;
  zero rows → 404, same as unknown.

## Supply Chain (new deps + scanner / native-audit result)
No new dependency planned. If one is added: run the supply-chain-guard scanner and `npm audit` before the PR (R10).

## Required Mitigations
| ID | Mitigation | Test that proves it | Phase |
|---|---|---|---|
| R1 | Auto-link sets `member_id` only to an EXISTING member of the same restaurant whose phone equals the booking phone under the repo's one phone normalizer; never creates a member, consent row or opt-in. Poppy/agent `unverified` bookings link only at verification (when status becomes `pending`), never before. The one-off backfill touches only rows with `member_id IS NULL` and status ≠ `unverified`. | Tests: matching member → linked; no match → stays null, no member row created; unverified poppy booking → null until the confirm code promotes it, then linked; other tenant's member with the same phone → not linked; backfill SQL on a scratch DB links only eligible rows. | 008 |
| R2 | Relink/unlink and member-bookings reads are tenant-scoped queries: booking by `{id, restaurant_id}`, target member by `{id, restaurant_id}`; any miss → 404; ids UUID-validated. | Route tests: other tenant's booking id → 404, nothing changed; other tenant's member id → 404, nothing changed; member panel bookings for member X never include another tenant's or another member's rows. | 008 |
| R3 | `member_id` never decides who is messaged or what a diner/agent sees: reminders, decision messages and the agent's `list_my_bookings`/change/cancel stay scoped by `booking.phone`. | Tests: a booking relinked to member B (other phone) → reminder/decision still sent to the booking phone; the agent for B's phone does not list it. | 008 |
| R4 | Each manual link/unlink writes an `events` row (`booking.member_relinked`, actor_user_id, booking id, old and new member id; no name/phone). | Route test: relink → one events row with those fields; failure to change → no row. | 008 |
| R5 | `no_show` is set only from `confirmed` and only when the booking's date+time (Asia/Hong_Kong) is in the past; staff can undo `no_show` → `confirmed`. DB CHECK allows the status with the decision columns consistent; a conditional UPDATE returns 0 rows otherwise (→ 409 already_handled). No WhatsApp message is sent on mark or undo. | Tests: confirmed + past → no_show; confirmed + future, pending, declined, cancelled → refused, unchanged; undo → confirmed; no sender call in either direction; migration validated on a scratch DB. | 007 |
| R6 | `no_show` stores who and when (`no_show_marked_by`, `no_show_marked_at`), cleared on undo. | Repository test: mark sets both; undo clears both. | 007 |
| R7 | No diner, poppy or agent path can write `member_id` after creation or set `no_show`; agent tools and diner APIs gain no new parameter. | Tests: agent tool declarations unchanged; poppy/diner routes have no field that reaches `member_id`/status `no_show`. | 007/008 |
| R8 | Member panel bookings list is capped (e.g. newest 50 + counts computed in SQL), tenant-scoped. | Test: 60 bookings → 50 rows, counts reflect all 60. | 008 |
| R9 | BOOK-001 retention purge and reminder/cover/status allow-lists handle `no_show`: purge clears name/notes on `no_show` rows like others; reminders never fire for `no_show`; covers exclude it; views render it. | Tests on purge fixture, reminder selection and covers with a `no_show` row. | 007 |
| R10 | No new dependency, or scanner + `npm audit` clean before PR. | PR body states result. | 007/008 |

## Open Risks & Acceptance (risks not mitigated, who owns acceptance)
- Staff can link a booking to the wrong member by hand (human error). Mitigated by audit (R4) and undo, not
  prevented. Owner: Xavier (accepted with the manual-edit ruling, 2026-11-20).
- Using no-show stats for campaign audience filters or tags would be a new purpose (DPP3) needing a notice or
  consent review. Not built here. Owner: Xavier, decide before any such feature.
- Diner-facing privacy notice does not mention no-show tracking (DPP5). Owner: Xavier / restaurant.

## Verdict: CONDITIONAL
Approved for build once the plan and briefs carry R1–R10 as acceptance items.

## Required Changes (if BLOCKED/CONDITIONAL)
- BOOK-007 brief: R5, R6, R7 (no_show part), R9, R10.
- BOOK-008 brief: R1, R2, R3, R4, R7 (member part), R8, R10.
