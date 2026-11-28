---
id: artifacts/evidence/2026-11-27-book-014-w4/walk-log
type: evidence
author: dev
created: 2026-11-28
status: active
related: [artifacts/2026-11-27-book-014-w4-handoff, specs/2026-11-27-book-014-booking-deposits]
---
# BOOK-014 W4 local walk (AC-3: staff see, refund, keep and request deposits)

## Environment
- Tree `whatsapp-crm--book-014-w4`, branch `feature/book-014-w4-staff`, final working tree. `next dev -p 3110` (slot 11) via `dev-run.sh`, once with `NEXT_PUBLIC_DEFAULT_LOCALE=zh-HK` and once with `en`.
- An isolated local Supabase: project `whatsapp-crm-w4`, a scratch copy of `supabase/config.toml` with ports 543xx shifted to 556xx (DB 55622, API 55621), fresh volume, so the CLI applied migrations 001..097. Excluded: realtime, studio, imgproxy, edge-runtime, logflare, vector, mailpit, postgres-meta, supavisor, storage-api. The repo `supabase/` folder is untouched. The stack was stopped after the walk (`supabase stop`, volume kept).
- Every external key is a dummy. `STRIPE_SECRET_KEY` is overridden with a fake `sk_test_` value, so the `.env.local` key is never read. Stripe is faked by `fake-stripe.cjs`: it patches `https.request` for api.stripe.com, returns fake checkout sessions on checkout.stripe.com, and returns refunds that succeed, or fail while `.fail-refunds` exists. WhatsApp is faked by BOOK-013's `fake-kapso.cjs`. Both load through `fakes.cjs`. Logs: `stripe-fake.jsonl`, `kapso-fake.jsonl`.
- Seed (`seed-walk.sh` + `seed-walk.sql`, rerun before every run, fake data only):
  - fake tenant "Walk Test Kitchen", user walk-staff@example.test with role **staff**;
  - an active fake Stripe account; deposit rule HK$100 per guest from 1 guest;
  - today, one booking per deposit state: Wong (staff, awaiting), Lee and Ho (pending, paid; both with an open 24 h window so the decline goes out as free text), Cheung (confirmed, paid), Ng (no-show, paid), Tam (cancelled, kept), Yip (cancelled, refunded), Kwok (cancelled, refund pending), Lau (declined, refund failed), Diner Hold (chat, awaiting, 5 guests), Diner Lapsed and Chan (no deposit);
  - yesterday, Fong (confirmed, paid), for marking a no-show.
- Driver: `walk.mjs` (raw CDP, headless Chromium; helpers from BOOK-013's `walk.mjs`), plain 1200x900 DPR 1 and 390x844 DPR 2, with the ui-layout-audit script on every `shot`. The page's clipboard writes are captured with an init script, because headless Chrome denies clipboard reads.

## Result
| run | checks | screenshots | page console errors | blocking |
|---|---|---|---|---|
| zh-1200 | 30/30 | 12 | 0 | 0 |
| zh-390 | 30/30 | 12 | 0 | 0 |
| en-1200 | 30/30 | 12 | 0 | 0 |
| en-390 | 30/30 | 12 | 0 | 0 |

"Console errors" excludes exactly two entries per run: the browser's "Failed to load resource 409" for the walk's own deliberate probes (a second Refund and a Keep after Refund, both expected to answer 409).

Checks per run (`walk-steps-<tag>.json`):
- **Today:**
  - the staff hold is listed; the diner hold and the lapsed one are not;
  - badges show awaiting, paid, and paid on the no-show; no badge without a deposit;
  - the no-show shows "Deposit held" with Refund and Keep; the staff hold has Copy link.
- **Table:**
  - the badges read awaiting, paid, kept, refunded, refund pending and refund failed;
  - refund failed offers Retry; the diner hold and the lapsed one are not listed.
- **Calendar:**
  - the day total in the panel (and in the month cell at 1200) = listed guests + the diner hold's 5 (no-shows are left out, BOOK-007);
  - the chip deposit mark appears at 1200.
- **Decline paid (Lee):**
  - declined + refunded (reason declined), exactly 1 provider refund;
  - the WhatsApp text (free text, open window, diner language zh_hk) contains "你的訂金 HK$400 將會退回".
- **Decline with the provider refusing (Ho):**
  - declined stands, the deposit is refund_failed, and Retry is shown;
  - Retry makes it refunded on attempt 2, with the toast "refunded".
- **Cancel (Cheung):**
  - the dialog offers Refund / Keep / Decide later; picking Keep makes it cancelled + kept;
  - one 'kept' deposit_event carries the user.
- **No-show (Fong, yesterday):**
  - Mark no-show leads to "Deposit held HK$400" with Refund + Keep;
  - Refund makes it refunded (reason staff); a second Refund is no longer offered;
  - from the page, a second Refund and a Keep after it both get 409.
- **Staff create (Mak):**
  - with no phone there is no deposit option; with a phone, "Require deposit HK$400" appears, ticked; clearing the phone hides it;
  - save gives awaiting_deposit, staff, created_by, a 24 h hold and exactly 1 checkout session;
  - the toast says "Link not sent, share it yourself" with Copy link (no approved template, window closed); Copy link copies `http://localhost:3110/p/<token>`;
  - the row shows Awaiting deposit + Copy link; the row's Copy link copies the checkout.stripe.com session URL.

Screenshots, each `× {zh,en}-{1200,390}`: `01-today`, `02-table`, `03-calendar-day`, `04-decline-refunded`, `05-decline-refund-failed`, `06-cancel-dialog`, `07-cancel-kept`, `08-no-show-held`, `09-create-no-phone`, `10-create-require-deposit` (viewport focus), `11-create-awaiting-toast`, `12-today-awaiting-row`.

## Layout audit
- 0 blocking on all 44 audited screens.
- Warnings in this diff that were fixed during the walk:
  - the calendar chip deposit mark spilled 7px in narrow month cells (the mark now gives way);
  - the deposit badge spilled 5px in phone rows (the badge now has max-w-full and truncate).
  The final runs show 0 deposit spills.
- Warnings left in this diff: `touch-target-small` on the cancel dialog's deposit radios (20px). The same size as the existing Notify checkbox, and the whole label row is the click target.
- Warnings outside this diff:
  - `column-indent` (BOOK-008's Link member `-ml-2`);
  - `row-misaligned` (app shell);
  - `content-spill` on the needs-reply pill;
  - `text-truncated` on calendar "N guests";
  - `layout-shift` since page load.

## Found and fixed during the walk
- `booking-deposit-repository.ts` `firstDeposit()` mapped RPC rows twice, so on real PostgREST every refund ended `not_refundable` and finish failed with a missing `p_attempt` (W1 code; the fakes hid it). Fixed, with a regression test; journal `debugging_journals/2026-11-28-book-014-deposit-rpc-double-mapping.md`. Logs: `repo-mapping-red.log`, `repo-mapping-green.log`.

## Not walked
- Diner pays → confirmed in the browser (no webhook delivery locally). Covered by `bookings-deposit.test.ts` ("paid -> confirmed by its creator") and the DB test (`mark_booking_deposit_paid` on a staff hold → confirmed, decided_by = creator).
- An approved `booking_deposit_request` template going out with its URL button (needs Meta approval). Covered by `deposit-request-template.test.ts` (wire payload: one URL button parameter carrying the /p token).
- The "Payment link sent" toast (needs an approved template or an open window for the new diner).
