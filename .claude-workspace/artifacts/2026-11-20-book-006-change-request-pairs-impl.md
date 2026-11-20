---
id: artifacts/2026-11-20-book-006-change-request-pairs-impl
type: artifact
author: dev
created: 2026-11-20
status: active
supersedes: null
superseded_by: null
related: [artifacts/2026-11-20-book-006-handoff]
---
# BOOK-006: a booking with an open change request is decided only through its change row

Stage: POC (no `stages/mature.md` import). Base 94e868ed, branch `fix/book-006-change-request-pairs`.

## Files Changed

| file | lines | purpose |
|---|---|---|
| src/domain/entities/booking-request.ts | +33 | `openChange` field + `OpenChangeSlot`; pure `needsReply(b)` and `pendingNeedingReply(total, pending)` (the count rule) |
| src/infrastructure/supabase/repositories/booking-request-repository.ts | +55 −6 | `readPendingRows` (one tenant-scoped read of the restaurant's pending rows), `openChangesFor` / `withChangeSlots` attach `openChange` on all three lists; `countRestaurantPendingBookings` = exact head count minus pending originals with an open change |
| src/components/dashboard/booking-row.tsx | +24 −5 | `ChangePendingLine` marker (`booking-row-<id>-change-pending`); `RowActions` renders nothing for an original with an open change; shared slot formatter |
| src/components/dashboard/bookings/bookings-table-desktop.tsx, bookings-table-cards.tsx | +6 −1 | marker beside the change-from line (desktop: notes cell, no "—" placeholder) |
| src/components/dashboard/bookings/booking-groups.ts | +4 −2 | pending chip count and day "N need a reply" use `needsReply` |
| src/components/dashboard/bookings/calendar-week-strip.tsx | +8 −5 | amber dot = any booking that `needsReply` |
| src/messages/en.json, zh-HK.json | +1 each | `bookings.changePending`: "Change requested → {to}" / "有更改要求 → {to}" |
| tests (5 files) | +297 −1 | see Tests |

Route `src/app/api/dashboard/bookings/route.ts` is unchanged: `pendingCount` still comes from `countRestaurantPendingBookings`, whose meaning changed.

## Key Decisions

- **Open-change lookup reads the restaurant's pending rows, not `in(listed ids)`.** A range list can hold 999 rows; an `in` on those ids overflows PostgREST's echoed `content-location` header (~390 UUIDs, memory `principle_postgrest_in_filter_header_overflow`). Pending rows are few (R11: 3 per phone). The read is tenant-scoped (R6), ordered newest first, and matched by `replaces_booking_id` against the listed originals, so a change dated outside the list still marks its original. It is skipped when the list has no pending/confirmed row. One extra query per list call.
- **No `.not('replaces_booking_id','is',null)` filter**: the recording Supabase test double (`src/test-utils/recording-supabase.ts`, outside files_allowed) has no `not`, and the in-memory route fake neither; change rows are filtered in JS.
- **Count rule** in the domain (`pendingNeedingReply`): exact head count minus pending rows whose `replaces_booking_id` is another pending row. Exact while the restaurant has ≤1000 pending rows (PostgREST `max_rows`); beyond that a pair outside the first 1000 rows read is counted twice (count high, never low).
- **Hidden, not disabled**: the original shows the marker and no buttons (brief preference).
- **Pending filter chip vs list**: the chip counts the pair once, but filtering "pending" still lists both rows (the original is still `pending` and shows its marker next to its change). So the chip can read 1 above 2 rows. Kept so staff see what the change replaces.
- **Out of scope, unchanged**: covers (guests) still add the original and the change (a pending 2 + its pending change to 4 shows 6 guests); month-grid chips keep the pending tone on the original; row tint unchanged.

## Tests

| file | cases | covers |
|---|---|---|
| src/components/dashboard/__tests__/bookings-views-agent003.test.tsx | +17 | AC-1 in day panel row, desktop table, phone cards: marker + no buttons on the original; change row keeps buttons + old → new; out-of-range change; confirmed original; after decline; copy keys in en + zh-HK; week-strip dot |
| src/components/dashboard/__tests__/booking-change-ui.test.tsx | +3 | AC-1 legacy row |
| src/components/dashboard/__tests__/booking-change-pairs-counts.test.ts | 4 (new) | AC-2 chip + day heading counts |
| src/domain/entities/__tests__/booking-change-pairs.test.ts | 7 (new) | count rule, needsReply |
| src/infrastructure/supabase/repositories/__tests__/booking-request-repository.test.ts | +5, 2 edited | AC-2 query shape, tenant scope, out-of-range attach, count; per-phone countPending stays one query |
| src/app/api/dashboard/bookings/__tests__/bookings-range.test.ts | +6 | AC-2 through the real route + repository on the in-memory table: pair → 1, unrelated → 2, confirmed original → 1, other tenant never marks, declined change → normal row |

Suite changed after the red commit (c66cb414): one assertion loosened (the next-intl mock double-encodes a nested var, so the `partyOf` check became a regex), and the week-strip tests were added. Edited pre-existing test: "r4: a range with no change request makes no replaced-slot read" asserted exactly 1 query; it now asserts no `in:id` (replaced-slot) query, since the open-change read now runs for any pending/confirmed row.

Gate (AC-3): `tsc --noEmit` + full vitest under the heavy lock, exit 0: 663 files passed / 14 skipped, 7584 tests passed.

## Design Gate

`impeccable detect --json src/components/dashboard/booking-row.tsx src/components/dashboard/bookings/` → `[]` (0 findings). The rendered-route detector pass was not run: the bookings route needs an authenticated tenant (no local stack).

## Visual Verification Hand-off

- Entry path: dashboard nav 訂座 / Bookings → Table view (or Calendar → a day).
- Evidence (AC-4): `artifacts/evidence/2026-11-20-book-006/ac4-{zh-HK,en}-desktop-1440.png`, `ac4-{zh-HK,en}-phone-390.png`. The real `BookingsHeader`, `BookingsFilters`, `BookingsTableDesktop` / `BookingsTableCards` with the real messages and the app's `globals.css` compiled by `@tailwindcss/postcss`, over fake bookings (`ac4-render.tsx.txt`). Not the running app: the page needs an authenticated tenant, and the local Supabase stack was not running. At 390: `scrollWidth` 390 (no horizontal overflow); the original's marker text matched; 0 buttons on the original, 2 on the change row.

## Review Hand-off

- `countRestaurantPendingBookings` now makes two queries (head count + pending rows) in parallel; every list call adds one pending-rows read. A route call therefore reads the pending rows twice (list + count); not merged, to keep the route unchanged.
- Locale files live at `src/messages/`, but the brief's files_allowed says `messages/**`. That path does not exist; the edit was taken as intended.

## Deferred / Tech Debt

- Covers (guests) count both rows of an open pair.
- `.claude-workspace/active/artifacts.md` index and `poc-log.md` not updated (outside files_allowed).
