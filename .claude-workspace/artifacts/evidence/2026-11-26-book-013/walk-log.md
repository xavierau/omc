# BOOK-013 local walk (2026-11-26)

## Environment
- Tree `whatsapp-crm--book-013`, branch `feature/book-013-staff-booking-crud`; `next dev -p 3060` (slot 6) with the Supabase variables pointed at the local stack (migrations 001..095 from `supabase start`), dummy Kapso / Gemini keys and `NEXT_PUBLIC_DEFAULT_LOCALE` per run (the app's locale comes from that variable). `.env.local` untouched.
- WhatsApp is faked by `fake-kapso.cjs` (a `NODE_OPTIONS=--require` preload): every api.kapso.ai / app.kapso.ai call is answered locally and logged to `kapso-fake.jsonl`; nothing leaves the machine. All names and phone numbers are fake.
- Seed (fake, SQL in the session scratchpad, reseeded before each run): "Walk Test Kitchen", mode simple, booking hours Mon–Sat Lunch 12:00–14:00 / Dinner 18:00–21:30, limits 20 per slot / 60 per meal, one member (Lam Chi Keung), approved QR `confirmed` templates (IMAGE header + `{{code}}`), Thu 2026-11-26 (today): Wu Siu Ming 18:30 confirmed, Au Ka Yan 13:00 arrived, Yeung Family 20:30 confirmed, Kan Wai 21:00 pending; Sat 2026-11-28: Hui Wing 20:30, Chat Diner 12:30 pending, Tsang Group 16 at 19:00.
- Driver: `walk.mjs` (headless Chrome for Testing 1208 over the DevTools protocol, Node 22, no dependency). Real login form, real clicks (Radix menu items by keyboard Enter), screenshots, then the ui-layout-audit script (v2026-09-17) on every screen. Runs: zh-HK and en, 1440×900 and 390×844 (mobile + touch). Walk time ~19:45–20:10 HKT.

## Result
24/24 checks pass in each of the 4 runs (`walk-steps-<locale>-<width>.json`), 0 page errors, 0 console errors. 14 screens per run, 56 screenshots.

| # | step | checks |
|---|---|---|
| 01 | Today view (`?view=today` on desktop, default on the phone) | Wu Siu Ming "Late 75+ min", Au Ka Yan "Arrived 12:58", Kan Wai "Needs reply", counters |
| 02 | Search | full code `p4mx8t` → server lookup card for the Saturday booking ("only today's bookings can be checked in"); phone digits `6555` → Yeung only; `<script>x</script>` → no match, no lookup |
| 03 | Arrived → Undo | row shows "Arrived HH:MM"; DB `checked_in_at` set, status stays confirmed; Undo clears it |
| 04 | Scan QR sheet | opens the existing scanner (headless has no camera: blocked state) |
| 05 | New booking | typed phone shows "Member: Lam Chi Keung"; slots show guests left; Notify ticked by default |
| 06 | Rules prompt | 19:00 Sat: "16 + 6 = 22, limit 20"; nothing written before Book anyway |
| 07 | Book anyway | row confirmed, source staff, 6-char code, created_by set, linked to the existing member, no new member row; `booking.staff_created` event carries `brokenRules: ["slot_full"]`; the fake Kapso log has the confirmed template with header `image.link = …/booking-checkin-qr/<random>.png` and the code in the body; QR path 36 chars, not the code |
| 08–10 | Table view, ⋯ menu, Edit | "By staff · walk-admin" badge and code on the row; edit to 4 guests marks "Changed"; saved: party 4, status confirmed, code kept |
| 11 | Stale edit | `updated_at` bumped in the DB while the form is open → 409 `changed`, stale banner, notes unchanged |
| 12–13 | Cancel | dialog with Notify; status cancelled, `cancelled_by` staff + user; toast "Saved. WhatsApp not delivered" (no approved `cancelled` template and no open window: correct) |
| 14 | Mode off | no Bookings link in the sidebar, "Bookings are off" + Settings → Booking link; `POST /api/dashboard/bookings` → `409 {"error":"booking_off"}` |

## Layout audit (`layout-audit.json`)
0 confirmed blocking findings. Raw blocking hits, all checked against the screenshots and not confirmed:
- `09-row-menu` (zh-1440, zh-390, en-390): `occluded` — the open ⋯ menu (Radix popover, fixed) covers the row content under it. That is the menu doing its job; it closes on select / Escape.
- `10-form-edit` (zh-1440 only): `occluded` — the Notify checkbox sits under the dialog's sticky footer at the dialog's scroll top. The dialog body scrolls (`max-h-[92dvh] overflow-y-auto`, footer `sticky bottom-0`); scrolled, the checkbox is above the footer (see `05-form-new-zh-390.jpeg`, same structure). en fits without scrolling.

Warnings kept: `row-misaligned` on the rules-prompt and toast rows (icon top-aligned with a 2-line text by design), CLS 0.19–0.25 at 390 on first load (the list replaces its loading state), Notify checkbox 20×20 (inside a full-width `<label>`, so the tap target is the label), and `column-indent` on the phone booking cards (BOOK-004 card layout, not changed here).

## Found and fixed during the walk
- Desktop form / cancel / scan dialogs sat at `left: 0 - 50%` (the sheet's `data-[side=bottom]:inset-x-0` beat `md:left-1/2`): now `md:left-1/2! md:right-auto! md:bottom-auto!` (`staff-booking-dialogs.tsx`, `bookings-today.tsx`).
- Editing a booking showed its own slot as Full (its own guests counted): `slotLeft()` gives them back in its own slot (`staff-booking-fields.tsx`, test in `staff-booking-ui.test.tsx`).
- At 390 en the Calendar toggle icon shrank to a dot (three views in a 3-column grid): icons `shrink-0`, toggle `px-2 sm:px-3` (`bookings-header.tsx`).

## Template backfill (`backfill-local.log`)
`scripts/ops/backfill-booking-templates.ts` against the same local stack, Kapso faked, the walk tenant's confirmed templates set to the old body without a header: dry run lists the 1 Simple tenant; `--apply` submits `changed` + `cancelled` (+ the not-yet-provisioned received / declined / reminder) and stores the QR `confirmed` version as the slot's candidate while the old approved one stays live; a second `--apply` creates no new rows. Locally the QR candidate stays a draft: the Kapso media step only accepts an https URL on the Supabase host, and the local stack is http://127.0.0.1. Prod storage is https on that host. The first local runs showed each retry created a new draft pair; fixed (a failed QR candidate is now resubmitted in place, test in `provision-booking-templates.test.ts`).
