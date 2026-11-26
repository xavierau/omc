---
id: artifacts/2026-11-26-book-013-staff-booking-crud-impl
type: artifact
author: dev
created: 2026-11-26
status: active
supersedes: null
superseded_by: null
related: [specs/2026-11-26-book-013-staff-booking-crud, threats/2026-11-26-book-013-staff-booking-crud, plans/2026-11-26-book-013-staff-booking-crud, design/2026-11-26-book-013-staff-bookings/mockup.html, artifacts/2026-11-26-book-013-handoff, kanban:BOOK-013]
---
# BOOK-013 staff booking CRUD + check-in: implementation note

Stage: POC (WT_STAGE=poc, no mature import). Branch `feature/book-013-staff-booking-crud`, base 4244ed63 (origin/develop).

## What was built
| layer | files | what |
|---|---|---|
| DB | `supabase/migrations/095_booking_staff_crud.sql` | source `staff`; `created_by`, `updated_by`, `cancelled_by='staff'` + `cancelled_by_user`; `notify_diner` (reminder candidates skip false); `last_staff_message_at` (R11); `checkin_code` (CHECK alphabet, unique per restaurant) and `checkin_qr_path` (CHECK 22–64 random chars); `checked_in_at/by` with CHECK not with `no_show`; 5 event types; bucket `booking-checkin-qr` (public, PNG ≤64 KB, no list policy); RPCs `staff_create_booking`, `staff_update_booking`, `staff_cancel_booking`, `booking_check_in`, `booking_check_in_undo` (service_role only, `search_path = public, pg_temp`, each writes its events row); `confirm_booking_change` 5-arg overload with codes; `mark_booking_no_show` refuses arrived; `member_booking_stats` + `arrived` |
| domain | `staff-booking-input.ts`, `staff-booking-rules.ts`, `booking-checkin.ts`, `tenant-role.ts`, `ports/staff-booking.ts`; `booking-templates.ts`, `booking-message.ts`, `booking-template-slot.ts`, `booking-config.ts` | allow-list parser (R4, R7); every broken rule listed, never refused (owner decision 3), self-exclusion on edit (AC-8); code / QR payload / strict parse / arrival states / counters / search; one `STAFF_ROLES` (admin, staff); kinds `changed`, `cancelled`; `confirmed` body with `{{code}}` and an IMAGE header |
| application | `create-staff-booking.ts`, `edit-staff-booking.ts`, `cancel-staff-booking.ts`, `staff-booking-shared.ts`, `booking-check-in.ts`, `booking-message-for.ts`, `booking-creator-names.ts`; `decide-booking-request.ts`, `provision-booking-templates.ts`, `edit-booking-template.ts`, `send-booking-message.ts`, `purge-booking-pii.ts`, `booking-no-show.ts`, `booking-deps.ts` | the S1–S3/S7 use cases; every confirm mints the code in the same write; confirmation carries code + QR (template header, or image + caption in the window); a QR template never goes out with its sample image; provisioning submits the QR `confirmed` as the candidate of a live one without it (AC-18); purge clears code + deletes QR files, daily sweep of QR files on closed bookings (R16) |
| infra | `staff-booking-repository.ts`, `checkin-qr-storage.ts`, `booking-request-repository.ts`, `booking-member-repository.ts`, `send-template-message.ts`, `enforce-header-media.ts` | RPC adapters scoped by restaurant; QR upload under a 192-bit random name, claimed with a conditional update; decide writes the code and retries on a code clash (23505 on the code index) |
| routes | `POST /api/dashboard/bookings`, `PATCH /bookings/[id]`, `POST /bookings/[id]/cancel`, `POST/DELETE /bookings/[id]/check-in`, `GET /bookings/today`, `GET /bookings/by-code/[code]` | admin/staff only (401/403), restaurant from the session, 404 for other tenants, 409 `booking_off` / `rules` / `open_change` / `changed`, 400 field errors |
| UI | `staff-booking-api.ts`, `use-staff-booking.ts`, `staff-booking-fields.tsx`, `staff-booking-dialogs.tsx`, `booking-staff-controls.tsx`, `bookings-today.tsx`, `use-bookings-today.ts`; `bookings-screen.tsx`, `bookings-header.tsx`, `bookings-view-state.ts`, `calendar-day-panel.tsx`, `booking-row.tsx`, table desktop/cards, `sidebar.tsx`, `member-bookings-section.tsx`, `booking-no-show-*` | New booking / + Add; form dialog (desktop) / bottom sheet (phone) with member line, slots with guests left, Other time, Notify; rules prompt with Book anyway; stale banner; ⋯ Edit / Cancel; cancel dialog; toast; "By staff · name"; code on rows; Today view (default on phone) with one search, Scan (existing scanner), counters, Waiting / Late / Arrived / No-show / Needs reply, Arrived + Undo also in day panel / table / cards; mode off: no nav entry + "Bookings are off"; member stats Arrived |
| ops | `scripts/ops/backfill-booking-templates.ts` | dry run lists Simple tenants; `--apply` runs the same provisioning for each (submits to Meta: a release step) |

## Decisions taken here (brief `decide_yourself`)
- Routes as listed above; search is client-side over the capped Today list; a whole code typed in the search box is looked up server-side (any date, this restaurant).
- Copy: en/zh-HK keys under `bookings.staff.*` and `bookings.today.*`, following the mockup frames.
- Fake WhatsApp locally: a Node preload (`evidence/2026-11-26-book-013/fake-kapso.cjs`) answers every api.kapso.ai call with a fake success and logs the payload; no app code knows about it.

## Deviations to note
- R3 says check-in / undo are conditional on `updated_at` as well. They are conditional on state only (confirmed, today, not arrived, no open change / arrived for undo): the reminder cron's claim bumps `updated_at` on the same day's bookings, so a Today list loaded before 16:00 would refuse every Arrived after its reminder went out. Double tap still changes the row once.
- R16 "cancelled/declined bookings delete their QR file at that transition": staff cancel deletes it inline; the diner-AI cancel and a confirmed change's cancelled original keep their file until the daily retention cron's sweep (≤ 24 h, `QR_SWEEP_LIMIT` 500 per run), so the diner and agent channels are untouched (brief escalate_if). A declined booking never had a QR (codes are minted at confirm).
- Existing-tenant templates: no automatic backfill on deploy. A Simple settings save submits `changed` + `cancelled` and the QR `confirmed` candidate; `scripts/ops/backfill-booking-templates.ts --apply` does it for every Simple tenant at once (owner's call, it submits to Meta).

## Round 2: review fixes R1, R2, R3, R7, R8, R10 (brief BOOK-013 r2, base ff8b241e)
QR delivery items (R4, R5, R6, R9, template image) are not touched here: the owner decides those first.

| fix | files | what |
|---|---|---|
| R1 | `095` (in place, unreleased), `staff-booking-input.ts`, `ports/staff-booking.ts`, `edit-staff-booking.ts`, `cancel-staff-booking.ts`, `staff-booking-repository.ts`, `booking-request-repository.ts` (STAFF_COLUMNS, mapper), `booking-request.ts`, `staff-booking-api.ts`, `use-staff-booking.ts`, `[id]/route.ts` (comment) | `edit_version INT NOT NULL DEFAULT 0` plus trigger `bump_booking_edit_version`: +1 only when status, date, time, party, name, phone, notes or notify change, whoever writes, and a writer cannot set it directly. `staff_update_booking` / `staff_cancel_booking` take `p_expected_version int`. API body `expectedVersion` (non-negative int4) replaces `expectedUpdatedAt`. `BookingRequest.editVersion` replaces `updatedAt` (STAFF_COLUMNS no longer reads `updated_at`). An open change request still answers 409 `open_change` |
| R2 | `decide-booking-request.ts` | `decided()`: `notifyDiner === false` → `delivered: null`, nothing sent, no outcome stored (confirm and decline). The code is still minted |
| R3 | `booking-request-repository.ts`, `095` (`forget_checkin_qr_paths`) | QR paths are read in keyset pages by id (max_rows), one page's files are deleted and then exactly those paths are forgotten (RPC with a JSON body, no `in` URL). A failed page is logged with counts and the error kind only, and keeps its paths. Purged rows are read too, so the next run retries them. The PII UPDATE no longer nulls `checkin_qr_path`, and the QR step never throws |
| R7 | `booking-checkin.ts` | `todayCounters`: a pending change whose original is in the same list does not count (the standing original does). A pending change whose original is another day still counts |
| R8 | `staff-booking-shared.ts`, `edit-staff-booking.ts`, `cancel-staff-booking.ts` | `messageDiner` stores an outcome only for kind `confirmed` (staff create). Edit and cancel return the outcome in `message` (toast) without changing `decisionMessageStatus` |
| R10 | `debugging_journals/2026-11-26-book-013-walk-fixes.md` | walk fixes 1–4 (b50ba492) and review R1–R3 |

Decisions (brief `decide_yourself`):
- R1 mechanism: a trigger-owned version column, not a field compare. Every writer is covered without changing its code, the client carries one integer that round-trips exactly, and the RPCs stay small. A field compare would need eight loaded values from the client and exact round-tripping of name, notes and time formatting.
- R8 storage: none. Changed/cancelled outcomes are answered (toast) and not stored, so no new column. After a reload the row badge shows the confirmation's delivery only.

Tests: red first (`evidence/2026-11-26-book-013-r2/red.log`, 53 failing), then green. Scratch DB: base 095 fails (`scratch-db-095-red.log`: `edit_version` does not exist), revised 095 passes 57/57 (`scratch-db-095.log`, on a throwaway supabase/postgres 17.6 container, port 55366, removed after).
