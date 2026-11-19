---
type: artifact
id: artifacts/2026-11-19-book-004-bookings-views-ux
item: BOOK-004
status: approved
owner_decisions: 2026-11-19 (chat): calendar is the default view; month scale only; API gets a date range; table soonest-first upcoming grouped by day; phone layouts mocked; week starts Sunday
design: .claude-workspace/artifacts/designs/2026-11-19-bookings-views.pen (+ PNGs in designs/2026-11-19-bookings-views-png/)
---

# BOOK-004 — Bookings page: calendar view + table view (UX spec + POC plan)

Learn-question: do restaurant staff handle bookings faster with a calendar/table than with the current flat card list? Who: Cafe Poppy staff on /dashboard/bookings.
Stage: POC (worktree slot 3). Surface mode: **Operate**.

## Screens (see PNGs)
- `calendar-1440.png` — default view. `table-1440.png` — table view. `calendar-390.png`, `table-390.png` — phone (< 768px).

## Task flow
1. Staff open Bookings → Calendar view, current month, today selected. Day panel lists today's bookings.
2. Click a day → panel shows that day; pending rows have Confirm / Decline (decline asks for an optional reason, same as today).
3. "N requests need a reply" pill → Show → switches the status filter to Pending (in Table view, so every pending booking is visible regardless of month).
4. Switch to Table → upcoming bookings (today onward), soonest first, grouped by day. "Show past bookings" → past bookings, newest first.

## Layout & components
Header: title + description (unchanged copy) · right: needs-reply pill, Calendar|Table toggle.
Toolbar: Calendar → prev / month label / next / Today. Table → range select (Upcoming | Past). Right side (both views): status filter chips All / Pending / Confirmed / Declined with counts for the loaded range; search box (name or phone, client-side, case-insensitive, digits-only match for phone).

**Calendar (≥ 768px):** month grid, weeks start Sunday, 5–6 rows, leading/trailing days of other months greyed. Cell: day number (today = filled primary circle), right-aligned "N guests" = sum of partySize over non-declined bookings. Up to 3 chips sorted by time: `HH:MM Name` (first word of name), colour by status (pending amber, confirmed green, declined grey + strike-through); then "+N more". Selected day = 2px primary border. Day panel 360px right: "Weekday, D Month" + "N bookings · N guests · N need a reply", rows sorted by time: time, pax, name, status badge, AI-agent badge, phone (tel: link), notes, decline reason, not-delivered badge, Confirm/Decline when pending.
**Calendar (< 768px):** month nav, 7-day week strip (selected day filled; marker dot amber if any pending, green if only decided), selected-day list below; prev/next moves by week on phone.
**Table (≥ 768px):** shadcn `Table`. Day group header rows ("Today · Thu 19 Nov", guests, "N need a reply"). Columns: Time · Guest · Phone · Party · Status (+ not-delivered badge) · Source (WhatsApp chat / Campaign / AI agent) · Notes · actions (Confirm/Decline on pending only). Pending rows tinted `pending-soft`.
**Table (< 768px):** cards grouped by day, same content; Confirm/Decline full-width.

Status colours: pending = the app's `--accent` (amber) family, confirmed = `--primary` family, declined = muted. Reuse existing `Badge`/`Button`/`Input`; no new tokens in globals.css unless needed for the amber soft tint.

## Feedback states (keep all current ones)
Loading (`booking-list-loading`), error + Retry (`booking-list-error`), empty month/range (`booking-list-empty`, copy adapted: "No bookings this month" / "No upcoming bookings"), action notice (`booking-action-notice` + `data-kind`), not-delivered badge, already-handled notice. Busy state disables the row's buttons as today.

## Test ids
Keep (same meaning, now rendered inside day panel / table row / card): `booking-list-loading|error|empty`, `booking-row-<id>`, `booking-row-<id>-status|confirm|decline|decline-reason|decline-send|not-delivered|via-agent`, `booking-action-notice`. Exactly one rendering of a booking row in the DOM per view (desktop OR phone layout, not both hidden).
New: `bookings-view-calendar`, `bookings-view-table` (toggle buttons) · `bookings-calendar` · `bookings-calendar-day-<YYYY-MM-DD>` · `bookings-calendar-prev|next|today` · `bookings-day-panel` · `bookings-table` · `bookings-range` · `bookings-filter-<all|pending|confirmed|declined>` · `bookings-search` · `bookings-needs-reply`.

## Data (API)
`GET /api/dashboard/bookings` gains optional `from`, `to` (YYYY-MM-DD, inclusive, on `booking_date`). With a range: every non-unverified booking of the tenant in range, ordered booking_date, booking_time asc, capped (e.g. 1000; set `truncated: true` if hit). Without params: current behaviour unchanged. Response adds `pendingCount` (all pending for the tenant, any date). Invalid date / from > to / span > 400 days → 400.
Client: calendar fetches the visible grid range; table Upcoming = from today (Asia/Hong_Kong), Past = last 90 days before today (shown newest first).

## Threat note (PII: diner names + phones)
R1 query scoped by `restaurantId` from `getTenantContext()` inside the repository query (not after fetch). R2 `unverified` agent bookings stay excluded (BOOK-003 R31). R3 `from`/`to` strictly validated; no string interpolation into filters. R4 row cap bounds response size. R5 names/notes rendered as text only (unchanged R3 of BOOK-001). R6 view/filter state in URL holds no PII (search text is not put in the URL).

## Plan (POC, ≤10 lines)
1. Repo: `listBookingRequestsInRange(restaurantId, from, to, cap)` + `countPendingBookings(restaurantId)`; route parses/validates `from`/`to`, returns `{bookings, pendingCount, truncated?}`; route tests.
2. Pure helpers (`src/components/dashboard/bookings/` or `src/lib`): month grid (Sunday start), group-by-day, covers, filter+search; unit tests.
3. `useBookings(range)` hook variant; keep `useBookingActions`.
4. Calendar view (month grid + day panel; phone week strip + list).
5. Table view (desktop table; phone cards).
6. Page: header, toggle (`?view=` URL param, default calendar, last choice in localStorage), toolbar, filters, search, needs-reply pill.
7. i18n keys in `en.json` + `zh-HK.json`.
8. Update existing booking UI tests for moved markup; testid registry rows.
9. Run it: local app, screenshots calendar + table at 1440 and 390 (en + zh-HK).

## Deferred
Week/Day scales; drag to reschedule; creating bookings from staff side; printing; restaurant timezone setting (HK assumed).
