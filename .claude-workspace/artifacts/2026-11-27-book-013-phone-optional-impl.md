---
id: artifacts/2026-11-27-book-013-phone-optional-impl
type: artifact
author: dev
created: 2026-11-27
status: active
supersedes: null
superseded_by: null
related: [specs/2026-11-26-book-013-staff-booking-crud, threats/2026-11-26-book-013-staff-booking-crud, plans/2026-11-26-book-013-staff-booking-crud, reviews/2026-11-26-book-013-r3-re-review, artifacts/2026-11-27-book-013-phone-optional-handoff]
---
# BOOK-013 decision 9: staff bookings without a phone (S8) + review N1

## Files Changed
| file | purpose |
|---|---|
| supabase/migrations/096_booking_staff_phone_optional.sql | phone nullable; CHECK phone or source staff; CHECK phone or notify off; staff_create/update (same signatures, REVOKE/GRANT) store Notify off without a phone; an update to a null phone matches only a staff row |
| src/domain/entities/booking-request.ts | `phone: string \| null`; `BookingWithPhone`, `hasPhone` guard; `AgentBooking.phone: string` |
| src/domain/services/staff-booking-input.ts | phone optional (empty/blank/null/absent → null), non-string → invalid; Notify forced off without a phone |
| src/application/booking/{staff-booking-shared,create,edit,booking-message-for}.ts | messageDiner returns `none` before the throttle claim for no phone; create/edit link no member without a phone; edit → `phone_required` for non-staff |
| src/application/booking/{decide-booking-request,send-booking-reminders,submit-booking-request,verify-agent-booking,agent-booking-full-reply,send-booking-message}.ts | every sender guarded by `hasPhone`; masked log prints `none` |
| src/app/api/dashboard/bookings/staff-response.ts | 400 `{error: phone_required, fields: {phone: required}}` |
| src/domain/services/booking-checkin.ts, components/dashboard/bookings/booking-groups.ts | phone search skips null phones |
| src/domain/services/booking-today-sort.ts | N1: unnamed (null or empty) last in the name tie-break under every key, and under the Name key |
| src/components/dashboard/{booking-row,bookings/*}.tsx/ts | "No phone" in rows; form label optional (new / staff source), Notify disabled + hint; cancel dialog likewise; body sends notify false without a phone |
| src/messages/{en,zh-HK}.json | `bookings.staff.phoneOptional`, `noPhone`, `notifyNoPhone` |
| infrastructure repos, test-utils/fake-staff-booking.ts | row types; fake mirrors 096 |

## Key Decisions
- R20 response shape: 400 with `error: 'phone_required'` and `fields.phone: 'required'`, so the existing form shows "Required." on Phone without new client code.
- N1 reading: unnamed rows go last wherever the name decides order (Name key and the name tie-break). Under Time/Guests/Status an unnamed row is not moved past a named row at another time (that would break the Lunch/Dinner grouping).
- Editing a phone-less booking starts the form with Notify ticked, so adding a phone offers it checked (AC-28); it is shown off and disabled while the phone is empty.
- Diner-channel guards (received, agent verify, full reply) are type guards for an impossible case (DB check); they skip the send rather than report not-delivered.
- Reminder function not changed: the 096 check keeps a phone-less row's notify off, and 095's candidate filter already requires notify (scratch DB check 19); the cron also filters `hasPhone`.

## Tests
Red: `evidence/.../red.log` (35 failing), `scratch-db-096-red.log` (13 FAIL on 095 alone). Green: touched 20 files / 323 tests; scratch DB 22/22; full vitest 733 files / 8660 tests passed. Suite changed deliberately in one place: the AC-4 case "phone missing → required" became "phone not text → invalid" (decision 9 makes an empty phone valid).

## Design Gate
`impeccable detect --json` on the four changed UI files: `[]` exit 0 (`impeccable-detect-src.json`). Live routes need a login the detector cannot do (as r3).

## Visual Verification Hand-off
Entry: Bookings in the sidebar → Today (phone default) / Calendar / Table; "New booking" button; row ⋯ → Edit / Cancel. Walk: `evidence/2026-11-27-book-013-phone-optional/walk-log.md`.

## Review Hand-off
- 096 `staff_update_booking` WHERE `(p_phone IS NOT NULL OR b.source = 'staff')`.
- The manual member link (BOOK-008 chip) still works on a phone-less booking; the next edit without a phone clears it (memberFor returns null).

## Deferred / Tech Debt
None.
