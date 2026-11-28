---
id: threats/2026-11-26-book-013-staff-booking-crud
type: threat
author: claude (main thread)
created: 2026-11-26
status: approved
supersedes: null
superseded_by: null
related: [kanban:BOOK-013, specs/2026-11-26-book-013-staff-booking-crud, threats/2026-11-20-book-007-008-member-bookings, threats/2026-11-19-agent-003-agent-booking]
---

# Threat Model: Staff create / edit / cancel bookings, check-in code + QR, Today view (BOOK-013)

## Assets
- Diner PII on `booking_requests`: phone, name, notes (entered by staff now, not only by the diner).
- Booking integrity: date, time, party, status, member link, guest counts (BOOK-010 limits).
- The diner's WhatsApp thread and the restaurant's Meta quality rating (every staff action can send).
- Check-in code per booking and its QR image.
- Audit trail: who created, edited, cancelled, overrode a rule, checked in.

## Trust Boundaries
1. Browser (signed-in admin/staff of tenant T) → `/api/dashboard/bookings/*` (session cookie; tenant from session only).
2. App → Supabase (service-role client: app checks are the only guard, per principle_lazy_flow_authorization_parity).
3. App → Supabase Storage public bucket (QR PNG reachable by anyone holding its URL).
4. App → Kapso/Meta (template + image link send to the booking phone).
5. Camera scan in the browser → API lookup (scanned text is untrusted input).

## STRIDE
- **Spoofing.** A user without a staff role, or of another tenant, acting on bookings → R1. A diner or agent path reaching the new staff endpoints → R1 (dashboard-only routes, session required).
- **Tampering.** Cross-tenant edit/cancel/check-in by booking id → R2. Lost update against a concurrent diner-AI change, personal-agent change or another staff member → R3. Mass assignment of `status`, `source`, `member_id`, `created_by`, `checkin_code` from the body → R4. Editing an original that has an open change request → R5. Bypassing mode `off` by calling the API → R6. Invalid values (party 0, 61-char name, past time, non-E.164 phone) → R7. Override of booking rules without trace → R9.
- **Repudiation.** "I didn't cancel that" → R9 (actor + time on every write, events row).
- **Information disclosure.** Today search / code lookup returning another tenant's diners → R2. QR image URL guessable or carrying PII → R10. Booking details sent to a wrong phone typed by staff → accepted (Open Risks). Logs with full phones → R13.
- **Denial of service.** A staff member's repeated edits flooding a diner with messages (Meta quality / block) → R11. Unbounded Today list or search → R12. Check-in code collisions → R8.
- **Elevation of privilege.** Staff role gaining admin-only actions: none added; both roles allowed by owner decision. Arrived on another day's booking, or on a cancelled/no-show booking → R14.

## OWASP Top 10 Coverage (applicable categories only)
- A01 Broken Access Control → R1, R2, R4, R6.
- A03 Injection → R7 (validated inputs, parameterised PostgREST/RPC only), R15 (scan text strict parse), notes/name rendered as text (unchanged BOOK-001 R3).
- A04 Insecure Design → R3, R5, R11.
- A05 Security Misconfiguration → R10 (bucket path, no listing).
- A09 Logging & Monitoring Failures → R9, R13.

## Secrets & PII
- No new secret. Kapso key and service role used as today, referenced by name only.
- PDPO (Cap. 486):
  - DPP1 collection purpose: staff collect phone + name to hold a table, the same purpose as diner channels. Met; no new collection.
  - DPP2 accuracy and retention: staff can now correct phone/name (improves accuracy). The BOOK-001 180-day purge must also clear the new free-text and code columns and delete the QR file → R16.
  - DPP3 use: messages are transactional (confirm, change, cancel, reminder) and only when Notify is on; a staff booking never creates a member, consent or marketing opt-in → R17.
  - DPP4 security: R1, R2, R10, R13.
  - DPP5 openness / DPP6 access: unchanged.
  - Part 6A direct marketing: not triggered (R17).
  - Cross-border transfer: unchanged (same Supabase and Kapso processors).

## Auth & Authz
- Every new route: `getTenantContext()` then the shared staff role allow-list (`admin`, `staff`, one constant replacing the three copies), restaurant id from the session only.
- Every read and write is a tenant-scoped query (`{id, restaurant_id}` in the WHERE), never fetch-then-compare (principle_authorize_by_scoped_query).
- State changes are conditional UPDATEs/RPCs on expected status and `updated_at`.

## Supply Chain (new deps + scanner / native-audit result)
- No new dependency planned: `qrcode` (^1.5.4, server PNG) and `html5-qrcode` (^2.3.8, camera scan) are already in `package.json` and used by coupons/Scan QR. If the dev adds any package, R18 applies.

## Required Mitigations
| ID | Mitigation | Test that proves it | Phase |
|---|---|---|---|
| R1 | Create, edit, cancel, check-in, undo check-in, Today list and code lookup require a session with role `admin` or `staff` for the tenant; one shared role constant. | Route tests per endpoint: no session → 401; role outside the list → 403, nothing written; admin and staff → allowed. | build |
| R2 | Every booking read/write is scoped by `restaurant_id` from the session inside the query (edit/cancel/check-in by `{id, restaurant_id}`; Today list and search by `restaurant_id` + date; code lookup by `{restaurant_id, checkin_code}`). Ids UUID-validated. Miss → 404 with no detail. | Route tests: other tenant's booking id → 404, row unchanged; other tenant's code → "not found", no field of that booking in the body; Today list never includes another tenant's rows (fixture with two tenants, same date). | build |
| R3 | Edit, cancel, check-in and undo are conditional writes on the expected status and the `updated_at` the client loaded; 0 rows → 409 `changed`, nothing written, no message sent. | Repository/route tests: stale `updated_at` → 409 and no sender call; status changed to cancelled meanwhile → 409. | build |
| R4 | Request bodies are parsed by an allow-list: create/edit accept only phone, name, partySize, date, time, notes, notify, override; server sets status (`confirmed` on create, unchanged on edit), source `staff`, member link (BOOK-008 rule), actor columns, check-in code. | Route test: body with `status: 'declined'`, `source: 'agent'`, `member_id`, `checkin_code`, `restaurant_id` → ignored; stored row has server values. | build |
| R5 | Edit is refused on an original with an open change request (`open_change`, 409); cancel likewise. | Route test with a pending change row → 409, original unchanged. | build |
| R6 | Mode `off` → create/edit/cancel/check-in API return 409 `booking_off` and write nothing; the page and nav hide (UX only, not the guard). | Route tests with mode off for each write → 409, no row change, no send. | build |
| R7 | Server validation: phone normalised to E.164 by the repo's one normaliser (invalid → 400); name 1–60; notes ≤500; party 1..`maxPartySize`; date+time not in the past (Asia/Hong_Kong); time `HH:MM`. Rule override never bypasses these. | Route tests for each invalid field → 400 with field code, nothing written; `override: true` with party above max → still 400. | build |
| R8 | Check-in code: 6 chars from the BOOK-003 confirm-code alphabet via CSPRNG; unique per restaurant among non-null codes (DB unique index); generated in the same write that makes a booking `confirmed`; retry on unique violation (max 5). | Unit test of the generator alphabet/length; DB test: forced collision → retried, distinct code stored; migration validated on a scratch DB. | build |
| R9 | Every staff create/edit/cancel/check-in/undo writes actor + time columns (`created_by`, `updated_by/at`, `cancelled_by='staff'` + `cancelled_by_user`, `checked_in_by/at`) and an `events` row (type, booking id, actor_user_id, and for overrides the list of broken rule codes; no name/phone/notes). | Route tests assert the columns and exactly one events row per successful action; failed action → no events row. | build |
| R10 | QR PNG encodes only `BK:<code>` (no name, phone, date, URL); stored under an unguessable path (random 128-bit name, not the code) in a dedicated public bucket without listing; the link is used only in the send. | Unit test: QR payload = `BK:` + code; storage path ≠ code and ≥22 random chars; bucket policy migration has no select/list for anon. | build |
| R11 | Diner messages from staff actions: only when Notify is on; an edit sends `changed` only if date, time or party changed; at most one staff-triggered message per booking per 5 minutes (later ones skip with a "not sent" notice). | Tests: notes-only edit → no send; two edits within 5 min → one send; notify off → no send; reminder flag off → reminder cron skips the booking. | build |
| R12 | Today list capped (e.g. 300 rows, `truncated` flag); search is client-side over that list or a server query with the same cap; code lookup returns at most one booking. | Route test: 301 bookings today → 300 + truncated. | build |
| R13 | Logs carry booking id and masked phone only (`***1234`), never name/notes/code. | Grep-style unit test on the new log calls, or a logger spy asserting masked output. | build |
| R14 | Arrived only on `confirmed` bookings dated today (HK), no open change, not no-show; no-show refused when checked in; undo clears `checked_in_*` only. Status stays `confirmed`. | Tests: tomorrow's booking → refused; cancelled/declined/pending → refused; no-show → refused and vice versa; undo → nulls. | build |
| R15 | Scanned and typed codes are parsed strictly (`^(BK:)?[alphabet]{6}$` case-insensitive); anything else → "not found" without a query. | Unit test with URLs, script strings, long input → not found, no repository call. | build |
| R16 | The BOOK-001 retention purge also nulls `checkin_code` and deletes the booking's QR file; cancelled/declined bookings delete their QR file at that transition. | Purge test on a fixture with code + file; cancel test asserts the storage delete call. | build |
| R17 | Staff create/edit never creates a member, consent row or marketing opt-in; member link only to an existing same-tenant member by phone (BOOK-008 R1). | Test: unknown phone → no member row, `member_id` null; other tenant's member with same phone → not linked. | build |
| R18 | No new dependency, or supply-chain scanner + `npm audit` clean, stated in the PR body. | PR body. | build |

## Open Risks & Acceptance (risks not mitigated, who owns acceptance)
- **Wrong phone typed by staff** sends the confirmation (restaurant, date, time, party, code) to a stranger. Mitigation is UX only (member match line under the phone helps spot typos). Owner: Xavier, accepted as the same risk as staff texting a wrong number today.
- **QR link is public** to anyone holding the URL; it reveals only a 6-char code usable solely inside a signed-in staff session of that restaurant. Owner: Xavier, accepted.
- **Rule overrides** let staff overbook. Intended (owner decision 3); traced by R9.

## Verdict: APPROVED

## Revision 2026-11-26 (spec decision 8: no check-in code, no QR)
Withdrawn with the feature: R8 (code generator), R10 (QR image + public bucket), R15 (scan parse),
the code/file half of R16 (the PII purge of name/notes stays), and the "QR link is public" open
risk. Trust boundaries 3 (public QR bucket) and 5 (camera scan) no longer exist. The code removal
must leave no `checkin_code` column, QR bucket, by-code route or scan UI behind.

## Revision 2026-11-27 (spec decision 9: phone optional for staff bookings)
Changed: R7 now reads "phone optional on staff create/edit; when given, E.164 by the one
normaliser, invalid → 400". Added:
| ID | Mitigation | Test that proves it | Phase |
|---|---|---|---|
| R19 | A booking without a phone never reaches a sender: DB checks `phone IS NOT NULL OR source = 'staff'` and `phone IS NOT NULL OR notify_diner = false`; the server forces Notify off when the phone is empty; decide, edit, cancel, reminder and any other send path return "no send" before the sender for a null phone. | Scratch DB: phone-less insert with source ≠ staff → refused; phone-less with notify true → refused. Route tests: create/edit/cancel/decide without a phone and `notify: true` in the body → stored notify false, sender never called, no "not delivered" outcome. Reminder selection test: phone-less booking never selected. | build |
| R20 | Clearing a phone is allowed only on source `staff` bookings, by the same tenant-scoped conditional write; it removes the member link. | Route test: clear phone on a source `agent`/`chat` booking → 400, row unchanged; on a staff booking → phone and member_id null. | build |
STRIDE delta: Tampering (a diner booking's phone cleared to silence messages) → R20. Information
disclosure: less PII collected, no new exposure; logs mask a null phone as none (R13 unchanged).
PDPO DPP1: collecting less is in line; no gap.

## Required Changes (if BLOCKED/CONDITIONAL)
None. The plan must map R1–R18 to work items, and the dev's acceptance suite must include a test per R-id.
