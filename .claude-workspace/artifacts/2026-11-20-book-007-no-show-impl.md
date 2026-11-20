---
id: artifacts/2026-11-20-book-007-no-show-impl
type: artifact
author: dev
created: 2026-11-20
status: active
supersedes: null
superseded_by: null
related: [threats/2026-11-20-book-007-008-member-bookings, plans/2026-11-20-book-007-008-member-bookings, kanban:BOOK-007, kanban:BOOK-006]
---

# BOOK-007 implementation note: no-show status (mark / undo)

Stage: POC. Branch `feature/book-007-no-show` from 2113af2e.

## Files Changed
| file | purpose |
|---|---|
| `supabase/migrations/087_booking_no_show.sql` | status CHECK + `no_show`; `no_show_marked_by`, `no_show_marked_at`; `decision_consistent` keeps `decided_at` for no_show; `no_show_marker` CHECK `(status = 'no_show') = (no_show_marked_at IS NOT NULL)` (R5, R6). Idempotent (DROP IF EXISTS / ADD COLUMN IF NOT EXISTS). |
| `src/domain/entities/booking-request.ts` | `BookingStatus` gains `no_show` |
| `src/domain/services/booking-no-show.ts` (new) | `hongKongMoment`, `isPastBooking`, `canMarkNoShow` (client offers the action; server re-checks) |
| `src/domain/ports/booking.ts` | `BookingNoShowStore`, `MarkNoShowArgs` |
| `src/domain/services/agent-booking.ts` | `agentBookingStatus`: no_show → `confirmed` (poppy GET, R7) |
| `src/application/booking/booking-no-show.ts` (new) | `markBookingNoShow` / `undoBookingNoShow`: UUID check, one conditional move, then 409 (current status) or 404 |
| `src/application/booking/booking-deps.ts` | `noShowBookingDeps()` = `{ store, now }`, no sender |
| `src/app/api/dashboard/bookings/[id]/no-show/route.ts` (new) | POST mark, DELETE undo; `getTenantContext`, role admin/staff else 403 |
| `src/infrastructure/supabase/repositories/booking-request-repository.ts` | `pastFilter`, `markBookingNoShow`, `undoBookingNoShow`, `bookingNoShowStore`; default decided list and range list allow-lists + `no_show` |
| `src/test-utils/fake-booking.ts` | fake `markNoShow`/`undoNoShow`; `findForRestaurant` now skips unverified like the repository (R41) |
| `src/components/dashboard/bookings/booking-groups.ts` | `STATUS_FILTERS` + `no_show`; counts; `covers` excludes no_show and originals with an open change |
| `src/components/dashboard/bookings/booking-no-show-action.tsx` (new) | `NoShowAction` (Mark no-show / Undo), `NoShowNoticeLine` |
| `src/components/dashboard/bookings/use-booking-no-show.ts` (new) | `requestNoShow`, `noShowOutcome`, `useBookingNoShow` (busy row, notice, refetch) |
| `booking-row.tsx`, `booking-list.tsx`, `bookings-table-desktop.tsx`, `bookings-table-cards.tsx`, `bookings-screen.tsx`, `bookings-filters.tsx`, `calendar-month-grid.tsx` | wiring: `onNoShow` through `BookingActionProps`; no_show tones (muted, like declined); chip test id kebab-cased (`bookings-filter-no-show`) |
| `src/messages/en.json`, `zh-HK.json` | `status.no_show` (No-show / 未出席), `markNoShow` (Mark no-show / 標記未出席), `undoNoShow` (Undo / 復原), `alreadyHandledStatus.no_show`, `views.filter.no_show` |

Tests: new `bookings-no-show.test.ts` (route, AC-1), `booking-no-show-repository.test.ts`, `booking-no-show-counts.test.ts`, `agent-booking-no-show.test.ts` (AC-2), `booking-no-show-ui.test.tsx` (AC-3). Existing expected lists extended with `no_show` (spec change, not weakened): `booking-request-repository.test.ts` (2 allow-lists), `bookings-views-helpers.test.ts` (counts + STATUS_FILTERS), `bookings-views-agent003.test.tsx` (counts literal for the type).

## Key Decisions
- **Unverified → 404, not 409.** AC-1 lists `unverified` under 409; the staff lookup (`findBookingForRestaurant`) hides unverified agent bookings (BOOK-003 R41), as confirm/decline already do, so a mark on one answers 404 with the row unchanged. The fake now mirrors that.
- **Past** = an earlier date, or today with `booking_time < HH:MM` now in Hong Kong (minute precision; a 19:30 booking can be marked from 19:31). Same rule in SQL (`pastFilter`, PostgREST or-tree, the complement of `upcomingFilter`) and client (`canMarkNoShow`).
- **Marker columns not added to `STAFF_COLUMNS`.** The UI needs only the status; keeping the shared select free of 087 columns means the lists keep working if code ships before the migration (memory principle_shared_select_migration_coupling). The mark/undo UPDATE writes them; AC-4 proves the CHECKs.
- **Agent `list_my_bookings` needs no mapping.** It reads upcoming bookings with `status IN (pending, confirmed)`; a no_show is past by construction, so it is never listed (test asserts the filter). The poppy GET maps no_show → `confirmed`; STATUS_ENUM unchanged (test asserts the published OpenAPI enums).
- **Purge / reminders unchanged in code.** The purge UPDATE has no status filter (covers no_show); reminder candidates (082 RPC) and the claim select `status = 'confirmed'` only. Both proven on the scratch DB.
- **Undo copy** is "Undo" / "復原" next to the 未出席 badge. No-show calendar chip is muted without strike-through (declined/cancelled keep theirs).
- **Client call lives in `components/dashboard/bookings/use-booking-no-show.ts`**, not `src/hooks/use-bookings.ts` (outside files_allowed); the notice has its own test id `booking-no-show-notice`.

## Tests
AC-1 21, AC-2 18 (repository 9, counts 6, poppy 3), AC-3 12. Gate: `tsc --noEmit && vitest run` under the heavy lock, exit 0: 668 files passed / 14 skipped, 7635 tests passed (`evidence/2026-11-20-book-007/ac5-gate.log`). eslint on the 27 touched src files: 0 errors, 0 warnings.

## Design Gate
`impeccable detect --json` on the 6 changed UI files: exit 0, `[]`. Rendered pass not run (no running app with an authenticated tenant); the AC-6 renders were checked instead: 390 scrollWidth 390 in en and zh-HK, action buttons 36px tall, cursor pointer.

## Visual Verification Hand-off
Entry path: dashboard nav → 訂座 / Bookings → Table view (Past) or Calendar → a past day. Evidence: `evidence/2026-11-20-book-007/ac6-{en,zh-HK}-{desktop-1440,phone-390}.png` (real components + messages + compiled CSS over fakes; `ac6-render.tsx.txt`, `ac6-checks.log`). Not the running app.

## Review Hand-off
- Migration 087 must be applied before the code is deployed (the code writes `no_show` and the marker columns).
- `pastFilter` interpolates only app-built values (YYYY-MM-DD, HH:MM from Intl), never input.
- Confirm on a no_show row answers 409 `already_handled` with status `no_show` (decide only moves pending rows).

## Deferred / Tech Debt
- No Playwright spec / layout harness in this repo (no `harness.md`); render tests + static renders instead (POC, as BOOK-006).
- `events` audit row for mark/undo not added (not required by R6; the columns record who/when, cleared on undo).
