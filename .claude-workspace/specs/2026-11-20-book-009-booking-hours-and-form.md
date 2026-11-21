---
id: specs/2026-11-20-book-009-booking-hours-and-form
type: spec
author: claude (main thread)
created: 2026-11-20
status: draft
supersedes: null
superseded_by: null
related: [kanban:BOOK-009, specs/2026-11-12-restaurant-booking, specs/2026-11-19-agent-booking-poppy, specs/2026-11-19-agent-003-agent-booking, specs/2026-11-20-agent-005-agent-skills]
---

# PRD: Booking hours, slot picker and booking terms (BOOK-009)

## Problem Statement

Our Simple booking form (BOOK-001, `/b/<token>`) takes any date from today on and any time
(`<input type=time>`), so a diner can ask for 03:00 or a closed Sunday, and staff decline it by hand.
All three samples studied on 2026-11-20 (Bicho and 挽肉と米 on inline, Henry on SevenRooms) only
offer times the restaurant takes, and show the house rules before the diner commits.

The three channels that create a booking (our booking page; personal agents through PAP / poppy.json,
BOOK-003; our own AI reply agent, AGENT-003) all validate through ONE parser,
`parseBookingSubmission` with `bookingRulesAt(now, maxPartySize)`. Today it knows only "not in the
past" and the party limit. The AI agent also reads 訂座規則, a free-text field (AGENT-005), which a
form and an external agent cannot use.

The ask: "create a spec for the simple booking form update… especially how to configure and input
those settings and info… also support personal agent and our own AI booking agent."

Owner decisions carried in (2026-11-20): deposits / payment later; no branch picker (no tenant runs
several branches on one WhatsApp number); live availability (table counts) later; dietary / birthday
profile tags are a separate spec.

## User Stories

### S1. Admin sets booking hours, the booking window and the booking terms
> "how to configure and input those settings and info"

Settings → Booking, Simple mode, gains these blocks (labels zh-HK / en), saved with the section's
existing Save:

1. **訂座時段 Booking hours**: a row per weekday (Mon–Sun). Each row is 休息 Closed, or one or more
   periods. A period has an optional label (午市 / 晚市…), a **first booking time** and a **last
   booking time** (not closing time; the hint says so). Row actions: "Copy to all days" and
   "Copy to Mon–Fri".
2. **時段間隔 Slot interval**: 15 / 30 / 60 minutes (default 30).
3. **訂座期限 Booking window**: minimum notice (0, 1, 2, 3, 6, 12, 24 hours; default 2) and
   how far ahead (7, 14, 30, 60, 90 days; default 30).
4. **特別日子 Special dates**: a list of dates, each Closed or its own periods, with an optional
   label (冬至, 聖誕…). Dates in the past drop out of the list.
5. **人數 Party size**: the existing max, now with the line the diner sees above it
   ("超過 {max} 位請在 WhatsApp 聯絡我們 / For more than {max}, message us on WhatsApp").
6. **用餐時間 Table time**: none / 90 / 120 / 150 / 180 minutes; shown to diners and agents, not
   enforced against other bookings.
7. **訂座須知 Booking terms**: one text per language (zh-HK, en), at most 1,000 characters each.
   When either is set, a diner must accept them to book.
8. **餐廳資料 Restaurant info** (shown on the booking page): address, enquiry phone, map link.
9. **Summary line**, live under the blocks, generated from 1–6: e.g. "Diners can book Tue–Sun
   12:00–14:00 and 18:00–21:30, every 30 minutes, 2 hours to 30 days ahead, up to 8 people. Closed:
   25 Dec." The same generator feeds the AI agent and the personal-agent API (S3, S4), so the admin
   reads exactly what the agents get.
10. **預覽 Preview**: opens the diner page with the SAVED settings, no token, submit disabled.

The existing 訂座規則 textarea stays, relabelled "其他訂座資料 (只供 AI 助手) / Other booking notes
(AI assistant only)", for what the structure cannot say ("large groups: set menu only").

- **AC-1** Given an admin in Simple mode, when they set Mon closed, Tue–Sun 午市 12:00–14:00 and 晚市
  18:00–21:30, a 30-minute interval, 2 h notice, 30 days ahead, and save, then reloading shows the
  same values and the summary line states them.
- **AC-2** Given a period whose last booking time is before its first, two periods on one day that
  overlap, a special date in the past, a terms text over 1,000 characters, or a map link that is not
  https, when the admin saves, then nothing is saved and each bad field shows its own error.
- **AC-3** Given "Copy to all days" on Tuesday's row, then every weekday row equals Tuesday's, and
  nothing is saved until Save.
- **AC-4** Given a special date 2026-12-25 set to Closed, then the summary lists it, and S2–S4 treat
  that date as closed while the weekday rule says open.
- **AC-5** Given a restaurant that has never set booking hours (every tenant today), then the
  booking page, the agent API and the AI agent behave exactly as before BOOK-009 (any time; terms
  and info blocks hidden when empty). Booking hours are opt-in.

### S2. Diner books on the page by picking an open day and slot
> "the simple booking form update"

- **AC-6** Given booking hours are set, when the diner opens `/b/<token>`, then they see, in order:
  restaurant name, logo and (when set) address / tap-to-call phone / map link; party size as
  buttons 1…max with the large-party line; a calendar from today to the window's end where closed
  days (weekly or special) are greyed and marked 休息, and days with no slot left (minimum notice)
  are greyed; the selected day's slots as buttons grouped by period label; the table time
  ("每枱用餐時間 2 小時"); name; notes with an example placeholder (過敏、BB 櫈、輪椅); the terms with
  a required tick (when terms are set); the existing bilingual collection statement.
- **AC-7** Given the diner has not chosen party size, day and slot, or not ticked the terms, then
  the submit button is disabled and its label names the missing step ("請選擇時段"); a summary bar
  ("2 位 · 11月21日 (六) · 19:00") stays visible at the bottom on a 390 px screen.
- **AC-8** Given a submission (from any client) for a closed day, a time not on the slot grid, a
  time inside the minimum notice, a date past the window, or without terms acceptance when terms are
  set, then the server refuses it with a per-field code (`closed_day`, `outside_hours`, `too_soon`,
  `too_far`, `terms_required`) and creates no booking.
- **AC-9** Given the admin changed the hours after the diner opened the page, when the diner submits
  a slot that is no longer valid, then the page says the times have changed, reloads the slots for
  that day, and keeps name, party size and notes.
- **AC-10** Given an accepted submission with terms set, then the booking stores that the terms
  were accepted, when, and the exact terms text accepted; staff see "已同意訂座須知 / Terms accepted"
  on the booking in 訂座 (detail), with the text.

### S3. A personal agent books within the same rules (PAP / poppy.json)
> "also need to support personal agent"

poppy.json itself does not change (it lives on the restaurant's domain and only points at our
OpenAPI URL, which is generated live).

- **AC-11** Given booking hours are set, then the OpenAPI description carries the summary line,
  the table time and the terms (both languages), and a new signed-out operation
  `GET /availability?from=YYYY-MM-DD&days=N` (N ≤ window, ≤ 31) answers, per date: `open` and the
  valid `times` for a party of `party_size` (query, optional), plus `interval_minutes`,
  `table_minutes`, `max_party_size`, `terms`. It is rate-limited like `POST /bookings` and answers
  404 under the same conditions (agent booking off, unknown publicId).
- **AC-12** Given `POST /bookings` outside the rules, then it answers 400 `invalid_request` with
  the S2 field codes (AC-8) and, for `outside_hours` / `too_soon` / `closed_day`, up to 3
  `suggested_times` (`{date, time}`, nearest first, same date before other dates).
- **AC-13** Given terms are set, then `POST /bookings` requires `accept_terms: true` (else 400
  `terms_required`), the OpenAPI states the agent must show the terms to the diner first, and the
  WhatsApp reply the diner gets after sending the confirm code includes the terms text.
- **AC-14** Given booking hours are not set, then the API is unchanged for existing agents:
  `/availability` returns every date open with `times: null` meaning "any time", and
  `accept_terms` is accepted but not required.

### S4. Our AI booking agent proposes only valid times and relays the terms
> "and our own AI booking agent"

- **AC-15** Given booking hours are set, then the agent's BOOKING RULES section is the S1 summary
  line plus the special dates in the window, the table time, the terms, then "Other booking notes"
  (the old 訂座規則 text), in that order; without booking hours it is the free text as today.
- **AC-16** Given the diner asks for a time outside the rules, when the model calls
  `propose_booking` (or `propose_booking_change`), then the tool returns the AC-8 code and the
  AC-12 `suggested_times`, stores no proposal, and the agent offers those times; it never calls
  `create_booking_request` for a refused time.
- **AC-17** Given terms are set, then the `propose_booking` result includes the terms, the agent's
  read-back states them ("請注意: …"), and the diner's agreeing message counts as acceptance; the
  booking stores acceptance as in AC-10 with source `agent`.

## UI Feedback States

| Action | Success | Warning | Rejected |
|---|---|---|---|
| Admin saves booking hours (S1) | "已儲存 Saved" next to Save; summary line updated | No periods on any day: "Diners cannot pick any time" under the hours block (save allowed, form then shows the off state) | Per-field errors (AC-2): `booking-settings-hours-<day>-error`, `…-special-<date>-error`, `…-terms-<lang>-error`, `…-map-error`; nothing saved |
| Admin copies a row (S1) | Rows updated in place, unsaved marker on Save | — | — |
| Admin opens Preview (S1) | New tab: diner page with saved settings, banner "預覽 Preview", submit disabled | Unsaved changes: "Preview shows the last saved settings" | — |
| Diner picks a day (S2) | Day selected, its slots shown | Day with fewer than 3 slots left: none (just fewer buttons) | Closed / full day not selectable (greyed, `aria-disabled`) |
| Diner submits (S2) | Existing `booking-sent` | — | Field code under the field (AC-8); `booking-times-changed` notice + reloaded slots (AC-9); existing too-many / rate-limited / failed notices unchanged |
| Agent `GET /availability` (S3) | 200 JSON per AC-11 | — | 400 bad `from`/`days`; 404; 429 with Retry-After |
| Agent `POST /bookings` outside rules (S3) | — | — | 400 with `fields` + `suggested_times` (AC-12) |
| AI agent proposes a refused time (S4) | — | — | Tool output: code + suggestions; diner reads alternatives |

Test ids follow `rules/frontend-testing.md`: `booking-settings-hours-<mon..sun>`, `booking-settings-interval`,
`booking-settings-notice`, `booking-settings-ahead`, `booking-settings-special-add`,
`booking-settings-table-time`, `booking-settings-terms-<zh_hk|en>`, `booking-settings-info-<address|phone|map>`,
`booking-settings-summary`, `booking-settings-preview`; page: `booking-party-<n>`, `booking-day-<date>`,
`booking-slot-<HHMM>`, `booking-terms-tick`, `booking-summary-bar`, `booking-times-changed`,
`booking-restaurant-info`.

## Scope

**In**
- Structured booking settings (S1 blocks 1–9) in Settings → Booking, Simple mode; Preview.
- One shared rule check used by all three channels (form, PAP API, AI agent tools), including
  change requests (`propose_booking_change`).
- Diner page: info line, party buttons, closed-day calendar, slot buttons, table time, notes
  examples, terms tick, summary bar, times-changed recovery.
- PAP: OpenAPI text, `GET /availability`, field codes + `suggested_times`, `accept_terms`, terms in
  the post-confirm WhatsApp reply.
- AI agent: generated BOOKING RULES, refusal + suggestions from the tools, terms in read-back.
- Terms acceptance stored per booking and shown to staff.
- zh-HK and en copy for every new string.

**Out**
- Deposits, card holds, cancellation fees (owner: later).
- Live availability / table or cover counts / sold-out slots / hold timers.
- Branch picker and multi-location (no tenant needs it; see Dependencies for the data shape).
- Dietary, occasion and birthday tags on member profiles (separate spec).
- Photos / cover carousel, menu, sister-brand suggestions, pre-order upsell.
- External mode (`mode: external`) restaurants: unchanged.

**Future**
- "Fill from text": AI turns the old 訂座規則 / knowledge text into the structured hours for review.
- Per-period party limits or per-period minimum notice.
- Showing the opening hours on the restaurant's poppy-demo / website.

## Explicitly Not Handled

- Bookings already made (pending or confirmed) that fall outside newly saved hours: left as they are.
- Staff deciding a request: staff can confirm any time; the rules bind diners and agents only.
- Periods crossing midnight (e.g. 22:00–01:00 last booking): not supported; last booking ≤ 23:45.
- HK public holidays as a built-in calendar: the admin adds them as special dates.
- Daylight-saving / other time zones: Hong Kong time only, as today.
- Different booking terms per period or per party size.
- Re-accepting terms when the admin edits them after a booking: the stored snapshot is what counted.
- A personal agent that ignores `/availability` and guesses: it gets AC-12 errors, nothing more.

## Dependencies & Risks

- **Data shape for a second location later**: owner said no tenant runs several branches on one
  number. Recommendation for `plan-architecture`: keep the new settings in one `bookingHours` value
  that a future location record could own, so adding branches moves no data. Decision for the owner
  at the scope check (Open Question 1).
- **Shared parser**: `parseBookingSubmission` grows from 3 rules to the full schedule; the form,
  the agent API and both AI propose tools call it. One change, three channels: the acceptance suite
  must hit all three.
- **Public surface**: `GET /availability` is a new signed-out endpoint on the BOOK-003 API. A short
  `threat-model` delta (rate limit, publicId enumeration, response size) before plan-architecture.
  Terms snapshots are restaurant text, not PII; the existing PII purge (`purge-booking-pii`) needs no
  change unless plan-architecture puts the snapshot on the booking row (then confirm it's kept).
- **WhatsApp copy**: the post-confirm reply (AC-13) is a free-form message inside the 24 h window
  the diner just opened; no new Meta template.
- **AGENT-005 prompt**: the BOOKING RULES section changes shape (AC-15); re-run the agent eval set
  in shadow on omc before switching a live tenant.

## Product Context

The repo has no PRODUCT.md. For the `ux-design` step:
- **Primary users**: (1) the restaurant owner or manager setting it up once on a laptop or phone,
  usually Chinese-first, not technical; (2) the diner, on a phone, arriving from a WhatsApp chat,
  usually zh-HK; (3) software agents (a diner's personal agent; our own AI reply agent).
- **What it makes possible**: a WhatsApp-native booking that only offers times the restaurant takes,
  states the house rules once, and gives agents the same truth as the page. Different from
  inline / SevenRooms: no sign-in, no email, no phone typing, no card; identity and confirmation stay
  in the WhatsApp chat.
- **Constraints**: no third-party scripts, fonts or images on the booking page (BOOK-001 R7);
  bilingual collection statement always shown (R18); text rendered as text, never HTML (R3).
- **Platform**: web, mobile-first (390 px) for the diner page; adaptive for settings.

## Open Questions

1. Keep the new settings shaped for a future location record (recommended), or plain restaurant-level?
2. Default for restaurants that turn booking hours on: should we pre-fill the weekly rows from
   anything (e.g. the AI knowledge text), or start empty? (Spec assumes empty + "Copy to all days".)
3. Minimum notice and window options: are the listed choices right for HK restaurants, or should
   they be free numbers?
4. Should the terms tick also be required when the diner books through our AI agent in chat
   (explicit "我同意" reply), or is agreeing to the read-back enough (AC-17 assumes enough)?
5. Which tenant pilots it first (Bicho uses inline today; omc is the demo)?

### Rulings 2026-11-20 (main thread, on review `reviews/2026-11-20-book-009-review`)

- **R-1 (P2-1): terms, restaurant info and table time work without the schedule.** Settings → Booking
  gets a switch at the top of the hours block, "使用訂座時段 / Use booking hours", stored as
  `bookingHours.scheduleEnabled` (absent in a stored value → on when any weekday or special date has a
  period, else off). Off → no slot rules on any channel (any time, as BOOK-001: the date/time form on
  the page, `/availability` times `null`, no schedule lines for the AI agent), while the terms (tick
  required), restaurant info and table time still apply. On → the S1–S4 rules above. The hours,
  interval/window and special-date blocks show only while it is on. Off with no terms, info or table
  time behaves exactly as hours not set (AC-5).
- **R-2 (P2-2): the PAP confirm-code step re-checks the rules.** Before a code promotes a booking,
  the shared check runs again at that moment. A slot that no longer passes is not promoted: it is
  declined with reason `rules` (no staff action) and the diner gets a WhatsApp reply (free-form, inside
  the 24 h window) that the time is no longer available, with up to 3 suggested times and the booking
  link. Terms required now and none stored on the booking → not promoted (left unverified until it
  expires), and the reply asks the diner to book again through their agent or the link. The
  post-confirm reply carries terms only when the booking stored them.

## Suggested work items (for plan-architecture; POC stage)

1. Domain: booking-hours value + shared rule check + summary generator + suggestions; settings API
   (S1 data, AC-2, AC-5, AC-8).
2. Settings UI blocks 1–10 (S1).
3. Diner page (S2).
4. PAP: OpenAPI text, `/availability`, codes, `accept_terms`, confirm reply (S3).
5. AI agent: BOOKING RULES section, tool refusals + suggestions, terms read-back (S4).
