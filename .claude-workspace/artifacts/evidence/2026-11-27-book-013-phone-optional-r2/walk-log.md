---
id: artifacts/evidence/2026-11-27-book-013-phone-optional-r2/walk-log
type: evidence
author: dev
created: 2026-11-27
status: active
related: [artifacts/2026-11-27-book-013-phone-optional-r2-handoff, specs/2026-11-26-book-013-staff-booking-crud]
---
# BOOK-013 r2 local walk (AC-26: no manual member link on a booking without a phone)

## Environment
- Tree `whatsapp-crm--book-013`, branch `feature/book-013-phone-optional`, working tree with the r2 change. `next dev -p 3060` (slot 6) via `dev-run-r2.sh`, once with `NEXT_PUBLIC_DEFAULT_LOCALE=zh-HK` and once with `en`. Every external key is a dummy. WhatsApp is faked by the r1 `fake-kapso.cjs`.
- Local Supabase for this repo (volume `supabase_db_whatsapp-crm`, already at 001–096). Another project's local stack (`ebclub`) held 54321/54322 and was in use, so it was left running. This repo's stack was started from a scratch copy of `supabase/config.toml` with every port shifted 543xx → 554xx (DB 55422, API 55421), with the same `-x` excludes as before. No migration was run and no reset. It was stopped after the walk (`supabase stop`, volume kept). Repo `supabase/` is untouched.
- Seed: `seed-walk-r2.sh` runs r1's `seed-walk.sql` unchanged (fake tenant, fake names and phones), then adds one phone-less staff booking "Walk-in Ho" (today 18:30, confirmed, notify off). Reseeded before every run.
- Driver: `walk-r2.mjs` (helpers copied from r1's `walk.mjs`; headless Chromium over CDP; plain 1440x900 DPR 1 and 390x844 DPR 2; the ui-layout-audit script on every `shot`). Views are reached through the real view tabs (`bookings-view-*`), and the day through `bookings-calendar-day-<today>`.

## Result
| run | checks | screenshots | console errors | confirmed blocking |
|---|---|---|---|---|
| zh-1440 | 12/12 | 7 | 0 | 0 |
| zh-390 | 12/12 | 7 | 0 | 0 |
| en-1440 | 12/12 | 7 | 0 | 0 |
| en-390 | 12/12 | 7 | 0 | 0 |

Checks per run (`walk-steps-<locale>-<width>.json`):
- Seed: Walk-in Ho (no phone) and Mr Chan (staff, with phone) are both unlinked.
- Today shows Walk-in Ho, and Today has no link control on any row (BOOK-008 never put one there).
- Calendar day panel: Walk-in Ho has no Link member; Mr Chan does.
- Table (desktop table / phone cards): the same.
- A PATCH `/api/dashboard/bookings/<Walk-in Ho>/member` with a real member id, sent from the signed-in page, returns 400 `{"error":"phone_required"}`. `member_id` stays NULL and no `booking.member_relinked` event is written.
- Mr Chan links through the UI (Link member → search "Lam" → pick): `member_id` is set and one event is written. Unlink then restores NULL.
- 0 console errors.

Screenshots: `01-today`, `02-calendar-day`, `02b-calendar-np-focus`, `02c-calendar-wp-focus`, `03-table`, `03b-table-np-focus`, `04-table-wp-linked` × `{zh,en}-{1440,390}`. The `*-focus` files are viewport captures with the row scrolled into view.

## Layout audit
0 blocking on all 16 audited screens. All warnings are outside this diff:
- `column-indent`: rows that show the BOOK-008 control (its `-ml-2`). There is one fewer in the day panel than in r1 (17 vs 18 at zh-1440), because Walk-in Ho no longer shows the control.
- `row-misaligned`: the app shell.
- `content-spill` (390, 3px): the "By staff" badge. It appears on Mr Chan too, who has a phone.
- `layout-shift` (en-390, 0.194): measured since page load.

## Not run
Impeccable detect on live routes (needs login); the static detect on `booking-member.tsx` returned `[]`.
