---
id: specs/2026-11-20-book-010-guest-limits-and-stop
type: spec
author: claude (main thread)
created: 2026-11-20
status: draft
supersedes: null
superseded_by: null
related: [kanban:BOOK-010, specs/2026-11-20-book-009-booking-hours-and-form, artifacts/2026-11-19-book-004-bookings-views-ux]
---

# PRD: Guest limits and stop-booking (BOOK-010)

## Problem Statement

After BOOK-009 a diner, a personal agent or our AI agent can only pick times the restaurant takes, but
nothing knows when a time is full: every request lands as pending and staff decline the overflow by
hand. The ask (2026-11-20): "how to know fully book? and stop further booking". Owner decisions:
both an automatic limit and a manual stop (option 1 + 2), as BOOK-010 on top of BOOK-009, counting
**guests** (party size), not tables.

Builds on BOOK-009's shared rule check: one place decides "can this be booked", used by the booking
page, the personal-agent API (PAP) and the AI agent's tools. BOOK-010 adds "is there room" to it.

## User Stories

### S1. Admin sets guest limits
> "how to know fully book"

Settings → Booking (BOOK-009 page) gains **人數上限 Guest limits**, after Party size:
- **每個時段最多 __ 位客人 / Guests per time slot**: guests arriving at one slot time (19:00).
- **每餐最多 __ 位客人 / Guests per meal**: guests across all slots of one period (午市, 晚市) on a date.
- Both optional; empty = no limit. Whole numbers 1–999. The summary line (BOOK-009 S1.9) adds them.

Counted per date: the party sizes of bookings with status **pending** or **confirmed** at that slot
(or in that period). A pending change request counts at its NEW time while the original still counts
at its old time (conservative; it frees when staff decide). `unverified` agent bookings (waiting for
the diner's WhatsApp code) do not count until the code arrives.

- **AC-1** Given an admin sets 30 per slot and 60 per meal and saves, then reloading shows both and
  the summary line says "每個時段最多 30 位，每餐最多 60 位".
- **AC-2** Given 0, a negative, a decimal, text, or a slot limit above the meal limit, when the
  admin saves, then nothing is saved and the field shows its error.
- **AC-3** Given no limits set (every tenant today), then nothing about room is checked and
  BOOK-009 behaviour is unchanged.

### S2. A booking that does not fit is refused, on every channel
> "stop further booking"

A request fits when, for its date: the slot is not stopped (S3), the period is not stopped, the day
is not stopped, `slot guests + party ≤ slot limit`, and `meal guests + party ≤ meal limit`.

- **AC-4** Given 19:00 on 2026-11-21 has 28 guests and the slot limit is 30, when a party of 4
  submits for 19:00 (page, PAP `POST /bookings`, or AI `propose_booking` / `create_booking_request` /
  `propose_booking_change`), then it is refused with field code `full` on `time` and up to 3
  `suggested_times` that fit a party of 4 (BOOK-009 AC-12 rules), and no booking is created.
- **AC-5** Given two requests for the last 4 seats arrive at the same moment (any mix of channels),
  then exactly one is created and the other gets `full`. The check and the insert are one atomic step
  in the database, not a read-then-write in the app.
- **AC-6** Given a personal agent's booking is `unverified` and the slot fills before the diner sends
  the WhatsApp code, when the code arrives, then the booking is not sent to the restaurant: it becomes
  `declined` with reason "full" (no staff action), and the diner gets a WhatsApp reply saying the time
  is full with up to 3 suggested times and the booking link.
- **AC-7** Given the AI agent proposed 19:00 and the slot filled before the diner agreed, when
  `create_booking_request` runs, then it returns `full` with suggestions; the agent tells the diner
  and offers them; nothing is created.

### S3. Staff see how full a day is and stop or resume bookings
> "how to know fully book? and stop further booking"

On Bookings (BOOK-004 calendar):
- Month cell: next to "N guests", a **已滿 Full** badge when no slot on that day fits a party of 1
  (limits reached or stopped), or **已停止 Stopped** when staff stopped the whole day.
- Day panel gains a **Capacity** block above the booking rows: one row per period with
  "26 / 60 guests" and a bar (only when a meal limit is set; else "26 guests"), expandable to its
  slots ("19:00 · 30 / 30 · 已滿"). Each day, period and slot has a **Stop bookings / 停止接受訂座**
  switch; a stopped item shows who stopped it and when ("Amy · 14:02").
- Stopping is reversible (switch back). It binds diners and agents only.

- **AC-8** Given staff switch off 晚市 on 2026-11-21, then from the next request on, page, PAP and AI
  agent refuse 晚市 times that date with `full`; 午市 is unaffected; the day panel shows 晚市 as
  stopped with the staff name and time; switching it back on reopens it (if room remains).
- **AC-9** Given staff stop the whole day, then the diner calendar greys the day as 已滿, the month
  cell shows 已停止, and `GET /availability` reports the day `open: false`.
- **AC-10** Given a pending request whose confirmation would take its slot or meal over the limit,
  when staff press Confirm, then they see "This takes 19:00 to 32 / 30 guests. Confirm anyway?" and
  can confirm; limits never block staff.
- **AC-11** Given a user without admin/staff access to the tenant, then they cannot stop or resume
  (API 403), and stops are scoped to the tenant (no cross-tenant read or write).

### S4. Diners and agents see full times as full
> "stop further booking"

- **AC-12** Given the diner chose a party size, then on the booking page a slot that cannot take that
  party stays visible, greyed, with **已滿** (not hidden), and is not selectable; a day with no
  slot that fits is greyed with **已滿** in the calendar (distinct from 休息 Closed). Changing party
  size re-evaluates both.
- **AC-13** Given the page was open while the time filled, when the diner submits, then BOOK-009
  AC-9's recovery applies with copy "這個時段剛剛滿了" and the slot now shows 已滿.
- **AC-14** `GET /availability` (BOOK-009 AC-11) returns, per date, only times that fit
  `party_size` (default 1) and `open: false` when none fit; the OpenAPI text explains `full`.
- **AC-15** The AI agent's BOOKING RULES section states the limits only as "some times may be full;
  always propose to check"; the agent never claims a time is free before the tool says so.

## UI Feedback States

| Action | Success | Warning | Rejected |
|---|---|---|---|
| Admin saves limits (S1) | "Saved"; summary line updated | Meal limit < one slot limit × slots: none (allowed) | Field errors (AC-2), `booking-settings-limit-slot-error`, `booking-settings-limit-meal-error` |
| Staff stop / resume (S3) | Switch flips; "Stopped by Amy · 14:02" under it; month cell badge updates | Stopping a period that has pending requests: inline note "3 requests still need a reply" (stop still applies) | API error: switch reverts, `bookings-capacity-error` "Couldn't update. Try again." |
| Staff confirm over limit (S3) | Booking confirmed, counts update | `bookings-confirm-over-limit` dialog (AC-10) | — |
| Diner picks party size (S4) | Slots / days re-evaluated | — | Full slot / day greyed 已滿, `aria-disabled` |
| Diner submits a full slot (S4) | — | — | `booking-times-changed` with full copy (AC-13) |
| Agent / AI request a full slot (S2) | — | — | `full` + `suggested_times` |
| Diner sends PAP code after slot filled (S2) | — | — | WhatsApp "full" reply with suggestions (AC-6) |

Test ids: settings `booking-settings-limit-slot`, `booking-settings-limit-meal`; staff
`bookings-capacity`, `bookings-capacity-day-stop`, `bookings-capacity-period-<label>`,
`bookings-capacity-period-<label>-stop`, `bookings-capacity-slot-<HHMM>-stop`,
`bookings-calendar-day-<date>-full`, `bookings-confirm-over-limit`, `bookings-capacity-error`;
page `booking-slot-<HHMM>` with `data-state="full"`, `booking-day-<date>` with `data-state="full"`.

## Scope

**In**: the two limits in settings; the atomic room check in BOOK-009's shared rule check for all
channels (incl. change requests and the PAP code step); staff stop/resume for day, period, slot;
capacity block and month badges in the BOOK-004 calendar; over-limit confirm warning; 已滿 states on
the booking page; `full` in the PAP API and AI tools; zh-HK and en copy.

**Out**: waiting lists; "nearly full" warnings or alerts to staff; table plans and table assignment;
counting overlapping seatings by table time (only arrivals per slot and per meal are counted);
walk-in and phone-booking counts (staff use stop instead); per-day or per-period different limits.

**Future**: per-period limits (午市 40, 晚市 60); limits per weekday; a "notify me when full"
WhatsApp alert to staff; waitlist.

## Explicitly Not Handled

- Bookings created before a limit is set or lowered: kept; the slot just reads over the limit.
- Staff Table view (BOOK-004): no capacity column; the calendar day panel is the one place.
- Phone layout of the capacity block beyond stacking it above the day's bookings list.
- A stop set on a date in the past: ignored.
- Expired `unverified` agent bookings never counted, so nothing to release.

## Dependencies & Risks

- **BOOK-009 first**: periods, slots and the shared rule check must exist.
- **Atomic check (AC-5)** needs a database function that locks the tenant's date while it counts and
  inserts; plan-architecture picks the mechanism. A real-Postgres test with two concurrent inserts is
  required (fakes cannot show a race).
- **Threat model delta**: the stop/resume API is a new write path on tenant data (authz R-ids as
  BOOK-004 R1); `GET /availability` now leaks fullness per slot, which is public anyway on inline /
  SevenRooms; the full-reply in AC-6 is a free-form message inside the diner's 24 h window.
- **Counts read the bookings table on every availability call**: one grouped query per date range;
  plan-architecture sets an index on (restaurant, date, status).

## Open Questions

1. Should `unverified` agent bookings hold seats for their 30 minutes (stricter, but a fake agent could
   block seats), or not (spec assumes not, AC-6 handles the race)?
2. Is "who stopped it" the staff member's display name, or just the time?
3. Pilot with the same tenant as BOOK-009?

## Suggested work items (POC)

1. DB: stops table + atomic check-and-insert function + count query; real-Postgres race test.
2. Shared rule check: `full` + suggestions for party size; wire into page, PAP (incl. code step) and AI tools.
3. Settings: the two limits.
4. Staff calendar: capacity block, stop/resume API + switches, month badges, over-limit dialog.
5. Diner page: 已滿 states, full recovery copy; `/availability` filtering.
