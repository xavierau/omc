# BOOK-013 walk fixes and review round 1 (staff booking CRUD + check-in)

Date: 2026-11-26. Branch `feature/book-013-staff-booking-crud` (PR #235). Sections 1–4 were found on
the local browser walk and fixed in b50ba492. Sections 5–7 were found by `/code-review` on PR #235
(review R1, R2, R3) and fixed in round 2. Each section: problem, root cause, fix, prevention.

## 1. Desktop dialogs stuck to the bottom-left of the screen (walk)

- **Problem:** at 1440 px the staff booking form, the cancel dialog and the Scan sheet were meant
  to be centred dialogs. They opened shifted off to the left (`left: 0` minus half their width)
  instead of centred.
- **Root cause:** the dialogs reuse the shadcn `Sheet` with `side="bottom"`. The sheet's own
  `data-[side=bottom]:inset-x-0 bottom-0` classes have a higher specificity than the plain
  `md:left-1/2 md:bottom-auto` overrides, so the overrides never applied.
- **Fix:** the desktop overrides use Tailwind's important modifier (`md:right-auto! md:bottom-auto!
  md:left-1/2!`) in `staff-booking-dialogs.tsx` and the Scan sheet in `bookings-today.tsx`.
  The phone sheet also got `max-h-[92dvh] overflow-y-auto`.
- **Prevention:** when restyling a library component per breakpoint, check the computed position in
  a browser at both breakpoints. A class that loses on specificity raises no error and fails no
  unit test. Only the browser walk caught it.

## 2. Editing a booking showed its own slot as full (walk)

- **Problem:** editing a 4-guest booking in a slot with 20 of 20 guests showed the slot as "Full",
  although moving nothing (or changing the notes) does not add anyone.
- **Root cause:** the form's slot buttons computed `limit - guests`, and `guests` already counts the
  booking being edited. The server side excluded it (AC-8 self-exclusion in `staff-booking-rules`),
  but the form did not do the same.
- **Fix:** `slotLeft(slot, date, own)` in `staff-booking-fields.tsx` gives the edited booking's own
  guests back in its own slot only. Other slots and other days are unchanged.
- **Prevention:** when the server applies a rule (self-exclusion), the display that previews the
  same rule needs the same input. `staff-booking-ui.test.tsx` "slot guests left in the form" checks it.

## 3. View toggle icon shrank to a dot on a phone (walk)

- **Problem:** at 390 px (en) the Calendar icon in the List / Calendar / Today toggle shrank to a dot.
- **Root cause:** Today made it three buttons in a 3-column grid. Each button kept a fixed `px-3`,
  and the flex icon was allowed to shrink, so the icon gave way first.
- **Fix:** `min-w-0`, `px-2 sm:px-3` and a `shrink-0` icon in `bookings-header.tsx`.
- **Prevention:** adding an item to a row of controls is a layout change. Look at the row at 390 px
  in every language, not only at the new view.

## 4. Every provisioning run created a new QR template draft (walk, local backfill)

- **Problem:** locally the Kapso media step refuses a non-https sample URL, so the QR `confirmed`
  candidate never reached Meta. Each backfill run then created a new pair of draft template rows.
- **Root cause:** `qrUpgradeDue` treated a candidate that never reached Meta (status `failed`) like
  no candidate at all, and always asked for a fresh one (`draftId: null`).
- **Fix:** a `failed` QR candidate is resubmitted in place (`draftId` = that candidate) in
  `provision-booking-templates.ts`.
- **Prevention:** a retried job must reuse what it created before. `provision-booking-templates.test.ts`
  "a QR candidate that never reached Meta is resubmitted in place" runs provisioning twice.

## 5. Staff Edit and Cancel refused nightly because of background writes (review R1)

- **Problem:** after the reminder cron ran, or once the QR file was claimed, the message status was
  stored or a guest checked in, every open edit form and cancel dialog for that booking answered
  "This booking changed, reload". Nothing a person would call a change had happened.
- **Root cause:** the conditional write compared the `updated_at` the form loaded. Migration 082's
  trigger moves `updated_at` on every UPDATE, including the background ones:
  `claimBookingReminder`, the QR `claimPath`, `recordDecisionMessage`, `claimStaffMessage`, check-in.
  The same problem had been seen for check-in and solved there (the "conditional on state"
  deviation), but the edit and cancel paths kept `updated_at`.
- **Fix:** migration 095 (unreleased, changed in place) adds `edit_version`. A BEFORE UPDATE trigger
  moves it only when status, date, time, party size, name, phone, notes or notify change, whoever
  the writer is, and a writer cannot set it directly. `staff_update_booking` and
  `staff_cancel_booking` take `p_expected_version int`. The API, the client and `BookingRequest`
  carry `editVersion` instead of `updatedAt`. An open change request is still refused by the
  existing NOT EXISTS check (409 `open_change`).
- **Prevention:** an optimistic-concurrency token must change only when what the user saw changes.
  Before using a timestamp as one, list every writer of the row. Tests: `bookings-staff-crud.test.ts`
  "review R1" (each background write, then the loaded form saves; each real change, then 409 with
  nothing written). Scratch DB 095 section 7b covers the same against real Postgres.

## 6. Notify off did not stop the confirm/decline message (review R2)

- **Problem:** staff edited a pending booking with Notify unticked and then confirmed it from the
  list. The diner still got the confirmation on WhatsApp.
- **Root cause:** BOOK-013 honoured `notify_diner` in its own `messageDiner` (create, edit, cancel)
  and in the reminder candidates, but the BOOK-001 decision path (`decided()` in
  `decide-booking-request.ts`) predates the column and always sent.
- **Fix:** `decided()` returns `delivered: null` without sending or recording an outcome when
  `booking.notifyDiner === false`, for confirm and decline alike. The code is still minted.
- **Prevention:** a new per-row "do not message" flag needs a check on every send path to that
  diner. Grep the sender port's callers (`deps.sender.send`) when adding one. Test:
  `book-013-confirm-qr.test.ts` "review R2".

## 7. A QR delete failure blocked the PII purge, and over 1000 paths were silently skipped (review R3)

- **Problem:** in the retention cron, (a) if the storage delete threw, the name and notes purge
  (PDPO R19) did not run that day, and (b) a single read returned at most 1000 QR paths
  (PostgREST `max_rows`), yet the UPDATE that followed nulled `checkin_qr_path` on every matching
  row. Files past the first 1000 stayed public with no stored path left to delete them.
- **Root cause:** the QR step was awaited before the purge without a catch, and the purge UPDATE
  nulled the path column itself, for rows whose path it had never read.
- **Fix:** `purgeBookingPii` reads the paths in pages by id (keyset, `max_rows` per page). For each
  page it deletes the files, then forgets exactly those paths through the new 095 RPC
  `forget_checkin_qr_paths` (a JSON body: 1000 values in an `in` filter would overflow PostgREST's
  echoed URL header). A failed page is logged (counts and error kind only, never a path) and keeps
  its paths. The read selects purged rows too, so the next run retries them. The PII UPDATE no
  longer touches `checkin_qr_path`, and the QR step never throws.
- **Prevention:** any "read then act" over a table must page past `max_rows` (memory
  `principle_postgrest_in_filter_header_overflow`). A side step in a compliance job must not be able
  to stop the compliance write. Tests: `booking-cron-repository.test.ts` "review R3" (2001 rows in
  3 pages; a failing page; a failing read).
