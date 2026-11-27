---
id: artifacts/evidence/2026-11-27-book-013-phone-optional/walk-log
type: evidence
author: dev
created: 2026-11-27
status: active
related: [artifacts/2026-11-27-book-013-phone-optional-handoff, specs/2026-11-26-book-013-staff-booking-crud]
---
# BOOK-013 decision 9 local walk (S8: a staff booking without a phone)

## Environment
- Tree `whatsapp-crm--book-013`, branch `feature/book-013-phone-optional` at the code commit, `next dev -p 3060` (slot 6) through `dev-run.sh` (local Supabase only, every external key a dummy), once with `NEXT_PUBLIC_DEFAULT_LOCALE=zh-HK` and once with `en`.
- Local Supabase (`supabase start`, CLI 2.109.1, same excludes as r3). The local DB already held 001–095 (r3); **096 applied with `supabase migration up --local`** (no reset, no data dropped). Stack stopped after (`supabase stop`, volume kept).
- Seed: r3's `seed-walk.sql` unchanged (fake tenant "Walk Test Kitchen", fake names and phones), reseeded before every run by `seed-walk.sh` (creates the fake admin or resets its password from a scratch file, never logged).
- WhatsApp faked by `fake-kapso.cjs` (Node preload, logs to `kapso-fake.jsonl`; no message leaves the machine).
- Driver `walk.mjs` (headless Chromium over CDP, plain 1440x900 DPR 1 and 390x844 DPR 2, the ui-layout-audit script on every `shot`).

## Result
| run | checks | screenshots | console errors | confirmed blocking |
|---|---|---|---|---|
| zh-1440 | 29/29 | 17 | 0 | 0 |
| zh-390 | 29/29 | 17 | 0 | 0 |
| en-1440 | 29/29 | 17 | 0 | 0 |
| en-390 | 29/29 | 17 | 0 | 0 |

Checks per run (`walk-steps-<locale>-<width>.json`): phone label "Phone (optional)" / "電話（選填）"; empty phone → Notify unticked + disabled + hint; typing a phone enables it (ticked), clearing disables it again; create saves confirmed / staff / phone NULL / member NULL / notify false; toast "added" (no not-delivered warning); zero WhatsApp sends; Today row shows "No phone" / "未有電話"; name search finds it, "9123" skips it; Arrived then Undo; Calendar day panel row and Table row show it (no tel: link); edit adds an existing member's phone → member linked, notify true, no message (no date/time/party change); edit clears "Mr Chan" (staff) → phone NULL, member NULL, notify false, no message; "Hui Wing" (chat) keeps the plain Phone label and clearing it is refused with "Required." / "必須填寫。", row unchanged; cancel dialog of the phone-less booking: Notify off + disabled + hint, diner line "No phone"; cancel stores cancelled by staff, no message; the whole run logged zero message sends.

## Layout audit
0 blocking in all 44 audited screens. Warnings: `column-indent` on rows with the BOOK-008 "Link member" control and `row-misaligned` on the app shell (same as r3, outside this diff); `touch-target-small` on the Notify checkbox at 390 (20x20 input), downgraded: the whole label row (≥ 60px tall, full width) is the click target. `*b-*-focus` screenshots are viewport captures with the element scrolled into view (the audited `shot` scrolls to the top).
