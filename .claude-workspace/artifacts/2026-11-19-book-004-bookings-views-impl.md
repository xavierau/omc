---
id: artifacts/2026-11-19-book-004-bookings-views-impl
type: artifact
author: dev
created: 2026-11-19
status: active
supersedes: null
superseded_by: null
related: [artifacts/2026-11-19-book-004-bookings-views-ux, artifacts/2026-11-19-dev-book-004-handoff]
---

# BOOK-004 — Bookings Calendar + Table views: implementation note

Stage: POC (`WT_STAGE=poc`, slot 3, port 3030). Branch `feature/bookings-calendar-table` from 49a3f582.

## Files Changed

| file | purpose |
|---|---|
| `src/domain/entities/booking-request.ts` | `BOOKINGS_RANGE_CAP` (1000), `BOOKINGS_RANGE_MAX_DAYS` (400), `parseBookingRange` (both-or-neither, real YYYY-MM-DD, from ≤ to, ≤ 400 days) |
| `src/infrastructure/supabase/repositories/booking-request-repository.ts` | `listBookingRequestsInRange` (tenant + status allow-list + date window in the query, date/time asc, reads cap+1 for `truncated`), `countRestaurantPendingBookings` |
| `src/app/api/dashboard/bookings/route.ts` | `GET(request)`: `?from&to` → `{bookings, truncated, pendingCount}`; no params → `{bookings, pendingCount}` (BOOK-001 list unchanged); bad range → 400 `invalid_range` |
| `src/hooks/use-bookings.ts` | `fetchBookings(range)`, `useBookings(range)` keyed to its range (never shows another range's rows), keeps last `pendingCount` while loading |
| `src/components/dashboard/booking-row.tsx` | shared row pieces (status badge with tones, agent badge, not-delivered badge, `RowActions` with `stretch`, notes, phone link); `BookingRow` = day-list row (time/pax column) |
| `src/components/dashboard/booking-list.tsx` | `BookingNoticeLine` kept; `BookingList` = the day-panel list (empty states moved to the views) |
| `src/components/dashboard/bookings/booking-dates.ts` | Sunday-first month grid, week of, HK today, UTC-safe formatting |
| `src/components/dashboard/bookings/booking-groups.ts` | status filter, name/phone search (digits match), counts, covers (declined excluded), day groups asc/desc |
| `src/components/dashboard/bookings/bookings-view-state.ts` | `resolveView` (param > localStorage > calendar), table ranges (Upcoming today..+365, Past 90 days), month/week stepping, try/catch storage |
| `src/components/dashboard/bookings/use-bookings-page.ts`, `use-media.ts` | page state hook; `useIsPhone` (`<768px`, desktop before hydration) |
| `src/components/dashboard/bookings/bookings-screen.tsx`, `bookings-header.tsx`, `bookings-toolbar.tsx`, `bookings-filters.tsx` | page composition, needs-reply pill, view toggle, month nav / range select, chips + search |
| `src/components/dashboard/bookings/bookings-calendar.tsx`, `calendar-month-grid.tsx`, `calendar-week-strip.tsx`, `calendar-day-panel.tsx` | Calendar view (desktop grid + 360px panel; phone week strip + day list) |
| `src/components/dashboard/bookings/bookings-table.tsx`, `bookings-table-desktop.tsx`, `bookings-table-cards.tsx`, `booking-day-heading.tsx`, `booking-source.tsx` | Table view (shadcn table with day group rows; phone cards) |
| `src/app/dashboard/bookings/page.tsx` | Suspense boundary (useSearchParams) around the screen |
| `src/app/globals.css` | 2 tokens: `--pending-soft`, `--pending-foreground` (amber tint + readable amber text) |
| `src/messages/en.json`, `zh-HK.json` | `bookings.pax`, `bookings.notDeliveredShort`, `bookings.views.*` |
| tests | `bookings-range.test.ts` (new, AC-1), `bookings-routes.test.ts` (request arg + pending mock), repository shape tests, `bookings-views-helpers.test.ts` (new), `booking-dashboard.test.tsx` (rewritten for the moved markup, every rendering), `booking-hooks.test.ts` (fetchBookings), `booking-agent-ui.test.tsx` (dropped `notice` prop) |

## Components

Reused: `ui/badge`, `ui/button`, `ui/input`, `ui/table`, `cn`, lucide icons. New: everything under `src/components/dashboard/bookings/` (feature folder named in the brief). No new `ui/` primitives.

## Hooks & State

No TanStack/Zustand in this repo's bookings code; matched the existing `useState`/`useEffect` hook style. URL (`?view=`) and localStorage hold the view only; status filter, search, selected day and table range are in-memory (R6: search never in the URL).

## Key Decisions

- One layout renders per view (`useIsPhone` via `matchMedia`), so each booking row exists once in the DOM. The month grid / week strip are not rows (chips carry no row test id).
- Range params are both-or-neither; one alone is a 400 (the spec said "optional from/to"; a half range has no defined meaning).
- Range query uses a status allow-list `in(pending, confirmed, declined)` rather than `neq(unverified)`. Same rows on this base; it keeps statuses a parallel branch adds (local stack carries a `085_agent_booking_changes` with `cancelled`) out of the views until someone decides how to show them.
- Desktop prev/next jumps a month (lands on today when that month holds today, else the 1st); phone prev/next moves a week; the fetch range is always the month grid of the selected day.
- Summaries (day guests, "need a reply", group headers) count what is shown after filters; chip counts are for the loaded range (spec). Covers exclude declined.
- Pill "Show" sets Table + Upcoming + Pending. Pending bookings dated before today are not in Upcoming, so the pill count (any date) can exceed the rows shown.
- Table views: the BOOK-003 `-via-agent` id sits on the Source cell ("AI agent") instead of a second badge; the day panel keeps the badge.
- `--pending-foreground` added because `--accent` amber text on white fails contrast for 12px badge text.

## Tests

AC-1 dir: 2 files, 25 tests (16 new range cases, real route + real repository on an in-memory PostgREST-filter fake). Repository: 10 (2 new). AC-2 dirs: 68 files, 841 tests (helpers 15, dashboard UI 29). Full suite: 644 files / 7258 tests passed, 11 files skipped. Red first: `evidence/2026-11-19-book-004/ac1-red.log` (12 failing before the route change).

## Design Gate

- `impeccable detect --json src/components/dashboard/bookings src/components/dashboard/booking-row.tsx src/components/dashboard/booking-list.tsx src/app/dashboard/bookings` → exit 0, 0 findings.
- Rendered-route detector pass not run: the route needs a signed-in session the detector cannot carry. The layout audit below covered the rendered pages.
- Layout audit (`ui-layout-audit` script, pasted) at 1440×900 and 390×844×2, en and zh-HK, calendar and table: 0 blocking on all 8 (`evidence/.../audits/`). Remaining warning on desktop: sidebar tenant name truncated ("Cafe Poppy (BOOK-004 local)", pre-existing sidebar, long scratch name). Fixed during the run: calendar cells top-aligned, phone `tel:` targets ≥24px, long not-delivered badge wraps, header controls grouped.

## Visual Verification Hand-off

- Entry path: sidebar → Bookings (`/dashboard/bookings`), Calendar by default; toggle → `?view=table`.
- Local stack used: the already-running shared Supabase CLI stack (project `whatsapp-crm`, 54321/54322); scratch tenant `b0040000-…0004` + user `book004-staff@example.test`, 35 seeded bookings mirroring the mocks (+1 unverified to prove R2). All deleted after the run (cleanup check: restaurant 0, user 0, the other tenant's 3 rows untouched).
- Exercised: calendar default at 1440 + 390; clicking 21 Nov fills the panel; Confirm on "Chat Diner" → badge Confirmed, chip green, pill 4→3, panel "1 needs a reply" (+ not-delivered badge: no WhatsApp locally); table via toggle and via `?view=table`; localStorage remembers Table on a bare URL; Show past bookings → 90 days newest first; pill Show → Table + Pending (3 rows); phone-digit search "9876 11" → 1 row, URL unchanged; phone week prev/next; zh-HK with no raw keys; 0 duplicate row test ids on phone.
- Evidence: `.claude-workspace/artifacts/evidence/2026-11-19-book-004/screens/` (ac4-*, ac5-*, ac6-*), `audits/`.

## Review Hand-off

- `src/hooks/use-bookings.ts` `useBookings`: data keyed by range; a refetch that fails after a decision replaces the view with the error state (same as BOOK-001).
- `src/app/api/dashboard/bookings/route.ts`: auth runs before range validation; 400 body is `{error:'invalid_range'}`.
- `bookings-view-state.ts` `todayInHongKong()` is computed per render on the client; a page left open past HK midnight keeps the old "today" until the next render.

## Deferred / Tech Debt

- No `(restaurant_id, booking_date)` index; the range query rides the restaurant-leading indexes (fine at POC volumes; a migration was out of scope).
- How `cancelled` (085, other branch) should appear in the views.
- Pill "Show" cannot show pending bookings dated in the past.
- No Playwright spec / layout harness in this repo (`ui-map/harness.md` absent); POC stage, so the walk + pasted audit stand in.

## r2 (2026-11-19): needs-reply Show lists every pending booking

Owner decision 3: the pill's count and the list behind Show must agree. Before r2, Show opened Table → Upcoming + Pending, so pending bookings dated before today were counted but never shown.

| file | change |
|---|---|
| `src/infrastructure/supabase/repositories/booking-request-repository.ts` | `listPendingBookingRequests(restaurantId, cap)`: `eq(restaurant_id)` + `eq(status,'pending')` in the query, booking date/time ascending, reads cap+1 for `truncated`. Same filter as `countRestaurantPendingBookings`, so length = `pendingCount` up to the cap |
| `src/app/api/dashboard/bookings/route.ts` | additive `?status=pending` (alone) → `{bookings, truncated, pendingCount}`; any other `status` value, or `status` with `from`/`to` → 400 `{error:'invalid_status'}`. No-param and `from&to` behaviour unchanged |
| `src/hooks/use-bookings.ts` | `BookingsQuery = BookingDateRange \| {status:'pending'}`; `fetchBookings(query)`; `useBookings` keyed by the query's search string |
| `src/components/dashboard/bookings/bookings-view-state.ts` | `TableRange` gains `pending`; `SHOW_PENDING` (Table + pending range + Pending filter); `fetchRange` returns `{status:'pending'}` for it; `tableOrder` asc for pending |
| `use-bookings-page.ts`, `bookings-toolbar.tsx`, `bookings-table.tsx` | Show applies `SHOW_PENDING`; the range select gains "Needs a reply" (soonest first); the table has its own footer ("Showing N bookings that need a reply") and empty title; its footer button goes to Upcoming |
| `src/messages/en.json`, `zh-HK.json` | `bookings.views.pendingRange`, `emptyPendingTitle`, `showingPending` |

Decision (decide_yourself): an additive API param rather than filtering the no-param list client-side. The no-param list also pulls 200 decided rows and orders by `created_at`. The new mode is the exact rows `pendingCount` counts, in booking order, under the existing cap. The select labels it "Needs a reply" / "待回覆", as a third table range beside Upcoming and Past.

Tests (red first, `evidence/2026-11-19-book-004-r2/ac1-red.log`: 10 failing): the API pending list includes past-dated rows, excludes confirmed/declined/unverified/other tenant, and its length equals `pendingCount`; cap + truncated; 4 × 400 `invalid_status`; the Show chain (`SHOW_PENDING` → `fetchRange` → `fetchBookings` → real route) yields `pendingCount` rows including a past-dated one; helpers; hook URL; the table's pending range orders a past-dated row first, with its own footer and empty state.

Walk (local Supabase stack, scratch tenant, en): sidebar → Bookings, pill "5 requests need a reply" → Show → `?view=table`, range "Needs a reply", chip Pending 5, 5 rows (Oct 2 and Nov 15 past-dated first), unverified row absent, footer "Showing 5 bookings that need a reply". At 1440 and 390: no horizontal overflow, select not clipped, 5 unique row ids. The full `layout-audit.js` was not re-pasted: the chrome-devtools MCP cannot read it by path, and r2 adds no new layout. Targeted geometry probes and screenshots stand in.

## r4 (2026-11-19): merge of develop (AGENT-003 #195, #198) and cancelled bookings

Merge commit 7c1c38c2 (`git merge origin/develop`, no rebase). Six conflicts: repository, booking-row, use-bookings, its test, kanban, poc-log. Migration 085 (AGENT-003) comes in with the merge; nothing beyond it.

| file | change |
|---|---|
| `src/infrastructure/supabase/repositories/booking-request-repository.ts` | `listBookingRequestsInRange` and `listPendingBookingRequests` select `STAFF_COLUMNS` and run `withReplacedSlots` (via `withReplacedSlotsIn` on the capped list); the range allow-list adds `cancelled`. readCap/cappedList (r3 F1) untouched; tenant scope and the unverified exclusion still in the query |
| `src/hooks/use-bookings.ts` | develop's `showsUndelivered` kept; r3 `runDecision` kept; `decisionOutcomeHandler(id, decision, sinks)` is the onOutcome `act` passes to `runDecision`, so `delivered: null` adds no badge |
| `src/components/dashboard/booking-row.tsx` | BOOK-004 structure kept; `STATUS_TONE.cancelled` (muted, as declined); exported `cancelledText`, `CancelledByBadge`, `ChangeFromLine` (AGENT-003 markup and test ids, unchanged); the day-list row uses them |
| `bookings-table-desktop.tsx`, `bookings-table-cards.tsx` | time + guest struck through for cancelled; cancelled-by badge in the status cell (desktop) / its own line (cards); change-from line in the notes cell (desktop) / under the meta line (cards) |
| `calendar-month-grid.tsx` | cancelled chip and dot tones (struck through, as declined) |
| `booking-groups.ts` | `STATUS_FILTERS` adds `cancelled`; `statusCounts` counts it; `covers` leaves it out |
| `src/messages/en.json`, `zh-HK.json` | `bookings.views.filter.cancelled`; `bookings.partyOf` restored (r3 F7 removed it as an orphan; AGENT-003's change-from line uses it) |

Decisions (decide_yourself):
- Cancelled gets its own status chip, like Declined; `All` shows no number, as before.
- The AGENT-003 bits are extracted into exported components in `booking-row.tsx` and reused by every view, not a reused `BookingRow` (the table and cards have their own layouts).
- Strike-through: the brief asks for grey + strike on cancelled in chips, day panel, table and cards. Declined is struck only on calendar chips (r1 design); declined rows were left as they are.

Tests (red first, `evidence/2026-11-19-book-004-r4/ac2-red.log`: 16 failing): repository range list allow-lists cancelled, never unverified, selects the AGENT-003 columns and reads replaced slots scoped by restaurant; pending list likewise; no slot read without change requests; groups leave cancelled out of guests and pending and count it under its chip; `runDecision` + `decisionOutcomeHandler` with `delivered` null / false / true; render tests (`bookings-views-agent003.test.tsx`) of the day row, desktop table and cards (cancelled-by testids, change-from, strike, no actions on cancelled), month grid chip strike + guests, the Cancelled filter chip, and every key used existing in en and zh-HK. The r3 range-list test now expects `cancelled` in the allow-list, and three r3 count expectations carry `cancelled: 0` (deliberate: owner decision, not weakened).

Walk: `evidence/2026-11-19-book-004-r4/ac4-walk.log` + 4 screenshots (zh-HK, 1440 and 390).
