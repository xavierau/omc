# 2026-11-28 BOOK-014 W6-fix: refunds marked done that never settled, late refunds nobody retried, a diner told two things

PR #237 /code-review findings F1-F4 (W6-fix round, branch feature/book-014-core).

## Problem
- F1: a staff refund that Stripe answered `pending` was marked `refunded` as soon as Stripe sent
  `charge.refunded`; when the refund later failed (`refund.updated` failed), that event was
  dropped. The diner's money was reported back while it was not.
- F2: a late-payment refund (the diner paid after the hold lapsed) that ended `refund_failed` was
  never retried. Its booking is lapsed, so staff never see it and never press Retry.
- F3: between the hold end and the lapse cron (up to ~5 min), /p said "lapsed, any payment will
  be refunded" while the webhook would still accept a payment as paid (seats held).
- F4: a `refund.updated` that arrived before our refund call recorded its refund id was answered
  `duplicate` (200, claim kept): Stripe never redelivered it and the settlement was lost.

## Root cause
- F1: `charge.refunded` was normalised to `refund_succeeded` with no refund id, and
  `finish_booking_deposit_refund(NULL, NULL)` treated it as "the payment is fully refunded". Stripe
  sends `charge.refunded` when a refund is CREATED (pending counts toward `amount_refunded`), and
  the event carries no refund list (`refunds` is expandable only). It is not a settlement.
- F2: the stalled-refund sweep only selected `refund_pending` rows with no refund id; a late
  refund that got an answer (`refund_failed`) left its WHERE clause for good (memory
  principle_backstop_only_repairs_what_it_selects).
- F3: `resolvePaymentLink` used the clock (`hold_expires_at <= now`) where the money path uses the
  row (`status = 'lapsed'`).
- F4: "refund id not matched" collapsed two cases: an earlier attempt's id (nothing to do) and an
  id not recorded YET (decidable later). Both returned null from `finishRefund`.

## Fix
- F1: `charge.refunded` -> `payment_refunded` (no refund id, `fullyRefunded`); it settles none of
  our attempts. `finish_booking_deposit_refund(NULL, NULL)` changes nothing.
- F2: `claim_late_booking_deposit_refund_retries` (097) claims late `refund_failed` rows as a NEW
  attempt (new key), due after 15 min x 4^(attempts-1) from the current attempt's claim, at most
  5 attempts (`late-refund-retries.ts`); the sweep issues each. At the cap:
  `deposit.late_refund_gave_up` at error level, row left `refund_failed`.
- F3: awaiting past the hold -> `checking` ("Checking your payment…"), any `?return`; `lapsed`
  only for a lapsed deposit.
- F4: before settling, `booking_deposit_refund_attempt_of` (097) is read; a `refund_pending`
  deposit with an unknown id -> `retry_later` -> the claim is released and the route answers 503,
  so Stripe redelivers. An earlier attempt's id is still `duplicate`.
- Tests: `src/application/payments/__tests__/w6-fix-refund-states.test.ts`,
  `src/app/p/[token]/__tests__/route-w6-fix.test.ts`, the W6-fix DB tests in
  `booking-deposits.db.test.ts`.

## Prevention
- Map each provider event to what it proves, from the provider's docs (Context7), not from its
  name: "charge refunded" is "a refund exists", not "the money is back".
- A backstop sweep's WHERE clause covers every terminal-looking state a row can be stranded in.
- A webhook outcome is three-valued: applied, nothing to do (200), or not decidable yet (5xx,
  claim released). Never fold "not yet" into "duplicate".
- Pages read the row's state, never re-derive it from a clock the cron also uses.
