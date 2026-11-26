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

POC learn-question: do restaurant staff move phone and walk-up bookings into OhMyClient so the
Bookings calendar becomes their one book? From: pilot tenants' staff. Where: `/dashboard/bookings`.

## User Stories

Who: any signed-in tenant member allowed to Confirm/Decline today (admin, staff). Where: the
Bookings page (BOOK-004 Calendar and Table, desktop and phone).

### S1. Staff create a booking
> "we need a way that staff can manually create booking"

A **新增訂座 New booking** button in the Bookings toolbar, and a **+** in the Calendar day panel
(date pre-filled). Form: phone (required, HK or international, normalised to E.164), name
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
- **AC-4** Given a missing or invalid field (phone not a number, party size 0 or above the max,
  past date-time, name empty), when staff save, then nothing is saved and the field shows its error.
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

### S6. The confirmation carries a check-in QR and short code
> "once booking confirmed, there should be a confirmation message with the qr code. of course with the short code"

Every booking that becomes `confirmed` (staff Confirm on a request of any source, a confirmed change
request, a staff-created booking with Notify on) gets a **check-in code**: 6 characters from the
BOOK-003 confirm-code alphabet (no 0/O/1/I), unique among this restaurant's live bookings, kept
through edits. The QR encodes only that code (no name, phone or URL), so it is useless without a
signed-in staff session of this restaurant.

- **AC-17** Given a booking is confirmed with a message to send, then the diner receives the
  `confirmed` message with the QR as an image header and the code in the body ("入座編號 Check-in
  code: K7Q2MX"), through the existing ladder: the approved image-header template, else (24h window
  open) an image message with the same text as caption, else not delivered (BOOK-001 warning).
- **AC-18** Given a restaurant whose current `confirmed` template has no QR (every live tenant
  today), then the new version is submitted through the BOOK-002 candidate flow and the old approved
  one keeps sending (without QR and code) until Meta approves; staff still find the booking by name
  or phone (S7).
- **AC-19** Given Notify is unchecked on a staff-created booking, then it still gets a check-in
  code (shown on the booking row) but no message.

### S7. Staff check diners in from a Today view
> "staff should have a very easy way to search the booking by phone, code, qr or name also like today view"

The Bookings page gains a third view, **今日 Today** (Today | Calendar | Table), the default on a
phone. It lists today's (Asia/Hong_Kong) pending and confirmed bookings by time, each with its
arrival state (**Waiting**; **Late 18 min** once 15 minutes past the time; **Arrived 19:04**;
**No-show**), and counters (guests arrived / expected, bookings waiting, late, no-show).
One search box matches name, phone (digits, any spacing or +852) and check-in code; a **Scan QR**
button opens the camera (the Scan QR page's scanner) and jumps to the scanned booking.

- **AC-20** Given today's list, when staff type part of a name, 4+ digits of a phone, or a
  check-in code, then the list narrows to matches as they type; a full code match opens that
  booking at once.
- **AC-21** Given staff scan a QR of this restaurant's booking for today, then that booking opens
  with **Arrived** ready; one tap records `checked_in_at` and the user, and the row shows "Arrived
  HH:MM". Given the code belongs to another day, then the booking shows with its date and no
  Arrived button; given it matches no live booking of this restaurant, then "找不到訂座 No booking
  for this code".
- **AC-22** Given a confirmed booking dated today, then **Arrived** is offered on its row (Today,
  Calendar day panel, Table) whether or not a QR was scanned; **Undo** clears it. Arrived and
  no-show exclude each other: a checked-in booking cannot be marked no-show, and the reverse.
- **AC-23** Given a booking was arrived, then the member panel stats (BOOK-008) count it as
  arrived ("Arrived 5 · No-show 1"); status stays `confirmed` (no new status value).
- **AC-24** Check-in by code or scan only ever finds this restaurant's bookings (lookup scoped by
  the session's tenant); a wrong code reveals nothing about other restaurants.

## UI Feedback States

| Action | Success | Warning | Rejected |
|---|---|---|---|
| Create (S1) | Toast "已新增訂座 Booking added"; the booking appears on its day, chip "by staff · <name>" | Rule prompt (AC-3) before save; after save, "WhatsApp 未送達 Message not delivered" on the row when the send failed (BOOK-001 warning) | Field errors (AC-4); "儲存失敗 Couldn't save" toast on server error, form kept |
| Edit (S2) | Toast "已更新訂座 Booking updated"; row shows new values | Rule prompt (AC-8); not-delivered marker as above | Field errors; "訂座已被更改，請重新載入 This booking changed, reload" (AC-11); Edit absent with open change (AC-10) |
| Cancel (S3) | Toast "已取消訂座 Booking cancelled"; row grey, struck through | Not-delivered marker as above | "訂座已被更改 This booking changed" (AC-13) |
| Search (S7) | List narrows; full code opens the booking | — | "沒有相符的訂座 No matching bookings today" (empty state) |
| Scan (S7) | Booking card opens with Arrived | Other-day booking: date shown, no Arrived | "No booking for this code"; camera denied → the Scan QR page's permission card |
| Arrived / Undo (S7) | Row shows "Arrived 19:04"; counters update; Undo restores Waiting | — | "This booking changed" (cancelled meanwhile); no-show already set → Arrived not offered |

Test ids (frontend-testing contract): `booking-new-button`, `booking-day-new-button`,
`booking-form`, `booking-form-<field>`, `booking-form-notify`, `booking-form-save`,
`booking-rules-prompt`, `booking-rules-override`, `booking-row-<id>-edit`,
`booking-row-<id>-cancel`, `booking-cancel-dialog`, `booking-form-stale`, `booking-toast`,
`bookings-view-today`, `bookings-today`, `bookings-today-search`, `bookings-today-scan`,
`bookings-today-empty`, `bookings-today-counter`, `booking-row-<id>-arrived`,
`booking-row-<id>-arrived-undo`, `booking-row-<id>-code`, `booking-scan-result`,
`booking-scan-not-found`, `bookings-off`.

## Scope

- **In:** S1–S7 above; check-in code + QR on confirmation; Today view with search and scan;
  Arrived/undo; mode-off hiding; source `staff` and its label; created_by / updated_by / cancelled-by-staff
  audit columns; a per-booking "no diner messages" flag honoured by the reminder cron; the two
  templates for new and existing tenants; zh-HK and en copy; desktop and phone layouts of the
  Bookings page.
- **Out:** hard delete; editing or cancelling declined/cancelled/no-show/unverified bookings;
  staff cancelling a pending booking (Decline covers it); creating members from the form.
- **Future:** a phone-number lookup in the form that suggests the member's name; booking from the
  member panel or the inbox conversation with phone pre-filled; walk-in entry without a phone.

## Explicitly Not Handled

- A booking with no phone (walk-in without a number): phone stays required (DB NOT NULL).
- Edit/cancel by the diner through the booking link (only AI agent and staff paths exist).
- Notifying the personal agent (PAP) of a staff edit/cancel; its GET status simply reads the row.
- Telling the diner the reason for a cancel (the `cancelled` template carries no reason).
- Undo of a cancel (staff create a new booking).
- A staff booking made within 3h of its time gets no reminder (existing BOOK-001 rule).
- Restaurant-wide toggle to stop staff overrides of rules.
- Automatic no-show for bookings never checked in (owner chose tap + QR, not auto).
- QR or code in the reminder, changed or cancelled messages (confirmation only, per the ask).
- Diner self check-in (diner scans a table QR or replies "I'm here").
- Check-in mode on the separate Scan QR page (the Today view's Scan button reuses its scanner).
- Partial arrival (4 of 6 guests arrived).

## Dependencies & Risks

- **Per-send QR image.** A template image header takes a media link per send. Decided (threat
  model R10): follow the coupon QR precedent (`src/infrastructure/supabase/storage.ts`): render the
  PNG with `qrcode`, upload to a dedicated public Storage bucket under a random path, send the link.
  The image holds only `BK:<code>`.
- **Template submit needs an example image** (`4:` handle): the Kapso Platform Media API path from
  PR #68 already mints it at submit.
- **Re-approval lag.** Live tenants send the old confirmation (no QR) until Meta approves the new
  one (AC-18); image-header templates can be rejected more often than text ones.

## Open Questions

1. ~~Booking mode~~ Resolved 2026-11-26 (owner): mode `off` hides Bookings (S5); `simple` and
   `external` allow staff CRUD.
2. Permissions: the app has two fixed tenant roles, `admin` and `staff` (`user_tenants.role`,
   migration 011, set by the platform admin), with no permission table; each route hard-codes its
   allow-list. Resolved 2026-11-26 (owner): admin + staff may create, edit, cancel and check in;
   the three copied `STAFF_ROLES` lists become one shared constant.
