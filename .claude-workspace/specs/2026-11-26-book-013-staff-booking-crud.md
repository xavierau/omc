---
id: specs/2026-11-26-book-013-staff-booking-crud
type: spec
author: claude (main thread)
created: 2026-11-26
status: draft
supersedes: null
superseded_by: null
related: [kanban:BOOK-013, specs/2026-11-20-book-010-guest-limits-and-stop, specs/2026-11-20-book-009-booking-hours-and-form]
---

# PRD: Staff create, edit and cancel bookings (BOOK-013)

## Problem Statement

Every booking today enters through a diner channel (chat link, campaign link, AI agent, personal
agent) and staff can only Confirm, Decline or mark no-show. A diner who phones or walks up has no
way into the calendar, and a diner who calls to change or cancel cannot be handled. The ask
(2026-11-26): "we need a way that staff can manually create booking", widened by the owner to
"completed CRUD operations".

Owner decisions (2026-11-26):
1. A staff-created booking starts **confirmed**.
2. Diner WhatsApp message on create, edit and cancel: a **checkbox, default on**. The 3h reminder
   follows the create/edit choice.
3. Booking rules (hours, notice, ahead window, guest limits, stops): **warn, staff may override**
   (as BOOK-010's over-limit confirm).
4. Delete = **soft cancel** (`cancelled`, cancelled by staff); no hard delete.
5. Edit and cancel apply to **every** pending/confirmed booking, whatever its source.
6. Edit/cancel messages use two new utility templates, `changed` and `cancelled`.
7. Check-in (2026-11-26): "once booking confirmed, there should be a confirmation message with the
   qr code. of course with the short code. in the staff should have a very easy way to search the
   booking by phone, code, qr or name also like today view". Staff also have a one-tap Arrived.
   Permissions: admin + staff (the two existing tenant roles; no permission table exists).
8. **Revised 2026-11-26 (owner): no check-in code or QR.** The owner's door practice: "staff at the
   entrance ... ask your booking info ... I say I have a reservation at what time and my surname
   ... they look up from their list." Check-in = Today list found by surname / time / phone + the
   Arrived tap. The code and QR (old S6) move to Future; the confirmation template is unchanged.
9. **Revised 2026-11-27 (owner): name required, phone optional for staff.** Owner: "name is
   required but phone is not". A staff booking may have no phone (a walk-in or a caller who won't
   give a number). No phone → no WhatsApp message of any kind, no reminder, no member link. Only
   staff-created bookings may lack a phone; every diner channel still requires one. Shipped as a
   follow-up PR after #235 (merged 2026-11-27).

POC learn-question: do restaurant staff move phone and walk-up bookings into OhMyClient so the
Bookings calendar becomes their one book? From: pilot tenants' staff. Where: `/dashboard/bookings`.

## User Stories

Who: any signed-in tenant member allowed to Confirm/Decline today (admin, staff). Where: the
Bookings page (BOOK-004 Calendar and Table, desktop and phone).

### S1. Staff create a booking
> "we need a way that staff can manually create booking"

A **新增訂座 New booking** button in the Bookings toolbar, and a **+** in the Calendar day panel
(date pre-filled). Form: phone (optional since decision 9; when given, HK or international, normalised to E.164), name
(required, 1–60), party size (required, 1–max party size setting), date (required), time
(required), notes (optional, ≤500), **以 WhatsApp 通知客人 Notify diner on WhatsApp** (checked).
The booking is saved `confirmed`, source `staff`, with the creating user recorded; it links to an
existing member of this restaurant with the same phone (BOOK-008 rule) and creates no member.
No per-phone caps apply (MAX_PENDING_PER_PHONE and the agent caps protect public channels only).

- **AC-1** Given staff fill a valid form within the rules with Notify checked, when they save,
  then a `confirmed` booking with source `staff` and `created_by` = that user appears in the
  Calendar and Table at once, counts toward guest limits, and the diner is sent the `confirmed`
  message through the existing ladder (approved template → free text in the 24h window → not
  delivered).
- **AC-2** Given Notify is unchecked, when staff save, then no message is sent at create and the
  3h reminder is never sent for this booking.
- **AC-3** Given the chosen time breaks a rule (outside booking hours or special-date closure,
  inside the notice period, beyond the ahead window, over the slot or meal guest limit, or a
  stopped day/period/slot), when staff save, then nothing is saved yet and a prompt names each
  broken rule (e.g. "19:00 已有 24 位，上限 20"); **Book anyway** saves it, **Back** returns to the
  form with the values kept.
- **AC-4** Given a missing or invalid field (a phone that is given but not a number, party size 0
  or above the max, past date-time, name empty), when staff save, then nothing is saved and the
  field shows its error. An empty phone is valid (decision 9, AC-26).
- **AC-5** Given the phone belongs to an existing member of this restaurant, then the booking
  shows that member (BOOK-008 member chip); given it belongs to a member of another restaurant
  only, then the booking links to no member.

### S2. Staff edit a booking
> "completed CRUD operations" (update)

An **編輯 Edit** action on every `pending` or `confirmed` booking of any source, opening the same
form pre-filled, with Notify checked. Status is unchanged by an edit.

- **AC-6** Given staff change date, time, party size, name, phone or notes and save, then the
  booking shows the new values, guest counts move with it, `updated_by`/`updated_at` are recorded,
  and with Notify checked the diner (at the new phone if it changed) is sent the `changed` message
  with the new date, time and party size.
- **AC-7** Given the date or time changed on a confirmed booking whose reminder was already sent,
  then the reminder is due again for the new time (reminder_sent_at cleared); given Notify was
  unchecked on this edit, then no reminder is sent for the booking from now on.
- **AC-8** Given the new slot breaks a rule, then the AC-3 prompt applies; the booking's own
  guests are not counted against itself when it stays in the same slot or meal.
- **AC-9** Given the phone changed, then the member link is re-resolved by the BOOK-008 rule.
- **AC-10** Given the booking has an open change request (BOOK-006), then Edit is not offered on
  the original and the API refuses it (`open_change`); staff decide the change row first.
- **AC-11** Given the booking was decided, cancelled or edited by someone else (staff, diner AI,
  personal agent) after the form opened, when staff save, then nothing is overwritten and the form
  says it changed; reload shows the current booking. (Conditional write on status and updated_at.)

### S3. Staff cancel a booking
> "completed CRUD operations" (delete = soft cancel, owner decision 4)

A **取消訂座 Cancel booking** action on every `confirmed` booking of any source (a pending one is
already handled by Decline), with a confirm dialog holding the Notify checkbox (checked).

- **AC-12** Given staff confirm the cancel, then the booking's status is `cancelled` with
  cancelled_by `staff` and the user and time recorded; it shows grey and struck through (BOOK-005),
  stops counting toward guest limits, gets no reminder, stays in the member's booking history; with
  Notify checked the diner is sent the `cancelled` message.
- **AC-13** Given the booking is already cancelled, declined, no-show, or changed by someone else,
  then the cancel is refused without change and the dialog says so (AC-11 rule).

### S4. Two new diner templates
> owner decision 6

- **AC-14** `changed` and `cancelled` join the booking template kinds (zh_hk + en): provisioned for
  new tenants and submitted for every existing tenant whose other booking templates are provisioned,
  shown and editable in Settings → Booking templates like the other four. Until Meta approves one,
  the send ladder applies (free text in the 24h window, else not delivered).

### S5. Booking mode off hides Bookings
> "if booking mode is off we better hide everything from the sidebar" (owner, 2026-11-26)

- **AC-15** Given the restaurant's booking mode is `off`, then the sidebar shows no Bookings entry,
  and opening `/dashboard/bookings` directly shows "訂座功能未開啟 Bookings are off" with a link to
  Settings → Booking (admins) instead of the calendar. Settings → Booking stays reachable so an
  admin can turn it on. Existing bookings are kept, not deleted.
- **AC-16** Given mode `off`, when anyone calls the staff create/edit/cancel API, then it is
  refused (`booking_off`) and nothing changes. Modes `simple` and `external` behave as S1–S3.

### S6. ~~The confirmation carries a check-in QR and short code~~ Removed 2026-11-26
Owner decision 8: no check-in code, no QR, no change to the `confirmed` template. AC-17, AC-18 and
AC-19 are withdrawn. Moved to Future.

### S7. Staff check diners in from a Today view
> "staff should have a very easy way to search the booking by phone, code, qr or name also like today view"

The Bookings page gains a third view, **今日 Today** (Today | Calendar | Table), the default on a
phone. It lists today's (Asia/Hong_Kong) pending and confirmed bookings by time, each with its
arrival state (**Waiting**; **Late 18 min** once 15 minutes past the time; **Arrived 19:04**;
**No-show**), and counters (guests arrived / expected, bookings waiting, late, no-show).
One search box matches name (any part, so a surname finds "陳生" / "Chan") and phone (digits, any
spacing or +852). The list is ordered by time, so "7:30, Chan" is found by time position plus
surname (owner decision 8). No code, no Scan button.

- **AC-20** Given today's list, when staff type part of a name or 4+ digits of a phone, then the
  list narrows to matches as they type.
- **AC-21** ~~Scan a QR~~ Withdrawn 2026-11-26 (decision 8). One tap on **Arrived** records
  `checked_in_at` and the user, and the row shows "Arrived HH:MM".
- **AC-22** Given a confirmed booking dated today, then **Arrived** is offered on its row (Today,
  Calendar day panel, Table); **Undo** clears it. Arrived and
  no-show exclude each other: a checked-in booking cannot be marked no-show, and the reverse.
- **AC-23** Given a booking was arrived, then the member panel stats (BOOK-008) count it as
  arrived ("Arrived 5 · No-show 1"); status stays `confirmed` (no new status value).
- **AC-24** The Today list and Arrived only ever reach this restaurant's bookings (scoped by the
  session's tenant).
- **AC-25** (owner 2026-11-26: "today booking list/table need sortable ... help staff to locate the
  booking even more easier") Given the Today list, staff can sort it by **Time** (default,
  earliest first), **Name** (A–Z; zh-HK names by the locale's collation), **Guests** (largest
  first) or **Status** (Late, Waiting, Needs reply, Arrived, No-show). Tapping the active sort again
  reverses it. On desktop the column headers sort (`aria-sort` set); on a phone a "Sort" select
  above the list does the same. Sorting works together with the search filter, and the choice
  stays in the URL (`?view=today&sort=name`, `&dir=desc`) so a reload keeps it. Ties fall back to
  time, then name; a booking without a name (diner channels allow it) sorts after named ones in
  every sort, tie-breaks included (review N1, 2026-11-27).

### S8. A staff booking without a phone (decision 9, 2026-11-27)
> "name is required but phone is not" (owner)

- **AC-26** Given staff leave the phone empty on create, when they save, then the booking is saved
  `confirmed` with no phone and no member link, and **Notify** is unticked and disabled in the form
  with the hint "沒有電話，不會發送 WhatsApp No phone, no WhatsApp message"; the server stores Notify
  off whatever the body says. No `confirmed`, `changed`, `cancelled`, decision or reminder message
  is ever attempted for a booking without a phone, and no "not delivered" warning is shown for it.
  A booking without a phone cannot be linked to a member by hand either (owner default
  2026-11-27): the BOOK-008 member chip's link action is not offered and the API refuses it
  (`phone_required`); adding a phone (AC-28) is the way to link. A phone added later sends nothing
  unless date, time or party changed (owner default 2026-11-27).
- **AC-27** Given a booking without a phone, then its rows (Today, Calendar day panel, Table) show
  "未有電話 No phone" where the number would be; Today search finds it by name; phone search skips
  it; edit, cancel, Arrived/Undo, no-show and the rules prompt work as for any staff booking.
- **AC-28** Given staff edit a booking and add a phone, then the member link is resolved (AC-9) and
  Notify becomes available (checked by default as AC-6); a message is sent only under the AC-6 rule
  (date, time or party changed). Given staff clear the phone, then the member link is removed and
  Notify turns off. Only bookings with source `staff` may have their phone cleared; for any other
  source the phone stays required.
- **AC-29** A booking from any diner channel (booking page, WhatsApp AI, personal agent) still
  requires a phone; the database refuses a phone-less row unless its source is `staff`, and refuses
  a phone-less row with Notify on.

## UI Feedback States

| Action | Success | Warning | Rejected |
|---|---|---|---|
| Create (S1) | Toast "已新增訂座 Booking added"; the booking appears on its day, chip "by staff · <name>" | Rule prompt (AC-3) before save; after save, "WhatsApp 未送達 Message not delivered" on the row when the send failed (BOOK-001 warning) | Field errors (AC-4); "儲存失敗 Couldn't save" toast on server error, form kept |
| Edit (S2) | Toast "已更新訂座 Booking updated"; row shows new values | Rule prompt (AC-8); not-delivered marker as above | Field errors; "訂座已被更改，請重新載入 This booking changed, reload" (AC-11); Edit absent with open change (AC-10) |
| Cancel (S3) | Toast "已取消訂座 Booking cancelled"; row grey, struck through | Not-delivered marker as above | "訂座已被更改 This booking changed" (AC-13) |
| Search (S7) | List narrows | — | "沒有相符的訂座 No matching bookings today" (empty state) |
| Arrived / Undo (S7) | Row shows "Arrived 19:04"; counters update; Undo restores Waiting | — | "This booking changed" (cancelled meanwhile); no-show already set → Arrived not offered |

Test ids (frontend-testing contract): `booking-new-button`, `booking-day-new-button`,
`booking-form`, `booking-form-<field>`, `booking-form-notify`, `booking-form-save`,
`booking-rules-prompt`, `booking-rules-override`, `booking-row-<id>-edit`,
`booking-row-<id>-cancel`, `booking-cancel-dialog`, `booking-form-stale`, `booking-toast`,
`bookings-view-today`, `bookings-today`, `bookings-today-search`,
`bookings-today-empty`, `bookings-today-counter`, `booking-row-<id>-arrived`,
`booking-row-<id>-arrived-undo`, `bookings-today-sort` (phone select; desktop headers use
role `columnheader` + name), `bookings-off`. (Removed with decision 8:
`bookings-today-scan`, `booking-row-<id>-code`, `booking-scan-result`, `booking-scan-not-found`.)

## Scope

- **In:** S1–S5, S7 and S8 above; Today view with search by name/phone;
  Arrived/undo; mode-off hiding; source `staff` and its label; created_by / updated_by / cancelled-by-staff
  audit columns; a per-booking "no diner messages" flag honoured by the reminder cron; the two
  templates for new and existing tenants; zh-HK and en copy; desktop and phone layouts of the
  Bookings page.
- **Out:** hard delete; editing or cancelling declined/cancelled/no-show/unverified bookings;
  staff cancelling a pending booking (Decline covers it); creating members from the form.
- **Future:** a phone-number lookup in the form that suggests the member's name; booking from the
  member panel or the inbox conversation with phone pre-filled; check-in code and QR in the confirmation (old S6), only if staff report the door lookup is slow
  (and only after Meta's rule on per-send template images is confirmed).

## Explicitly Not Handled

- ~~A booking with no phone~~ Now handled for staff bookings (decision 9, S8).
- Sending the confirmation to a phone added later by an edit with no date/time/party change (AC-28
  sends only under the AC-6 rule).
- Edit/cancel by the diner through the booking link (only AI agent and staff paths exist).
- Notifying the personal agent (PAP) of a staff edit/cancel; its GET status simply reads the row.
- Telling the diner the reason for a cancel (the `cancelled` template carries no reason).
- Undo of a cancel (staff create a new booking).
- A staff booking made within 3h of its time gets no reminder (existing BOOK-001 rule).
- Restaurant-wide toggle to stop staff overrides of rules.
- Automatic no-show for bookings never checked in (owner chose the Arrived tap, not auto).
- Any check-in code or QR (decision 8).
- Diner self check-in (diner scans a table QR or replies "I'm here").
- Partial arrival (4 of 6 guests arrived).

## Dependencies & Risks

- **Template approval lag.** Live tenants have no `changed` / `cancelled` template until Meta
  approves them; until then an edit or cancel message goes out only inside the 24h window, else
  "not delivered". The `confirmed` template is unchanged.
- **Dropped 2026-11-26:** a per-send QR image in the `confirmed` template. No Meta page read that
  day says a different image per send is allowed, and the repo had never done it.

## Open Questions

1. ~~Booking mode~~ Resolved 2026-11-26 (owner): mode `off` hides Bookings (S5); `simple` and
   `external` allow staff CRUD.
2. Permissions: the app has two fixed tenant roles, `admin` and `staff` (`user_tenants.role`,
   migration 011, set by the platform admin), with no permission table; each route hard-codes its
   allow-list. Resolved 2026-11-26 (owner): admin + staff may create, edit, cancel and check in;
   the three copied `STAFF_ROLES` lists become one shared constant.
