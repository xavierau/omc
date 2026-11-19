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
