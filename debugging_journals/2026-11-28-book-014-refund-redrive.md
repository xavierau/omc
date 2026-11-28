# 2026-11-28 BOOK-014: a refund claimed but never issued stayed refund_pending forever

Fix commit: 97fa5a85 (W1-fix, PR #237 review findings 1 and 2). Written up in W6-fix (F8).

## Problem
PR #237 review found three ways diner money could stay with the restaurant while our row said a
refund was under way:
1. A late payment (paid after the hold lapsed) moved the deposit to `refund_pending`
   (late_payment) and called the provider. If that call failed AND writing `refund_failed` failed
   (or the process died between the claim and the call), the row sat in `refund_pending` with no
   refund id. A redelivered `checkout.session.completed` was answered `duplicate`, so nothing ever
   issued the refund.
2. Staff Refund / decline had the same gap: no sweep looked at `refund_pending` rows.
3. A refund webhook was matched to the deposit, not to the attempt that made the refund: after
   Retry (attempt 2), a delayed `refund.updated failed` for attempt 1's refund could mark the
   deposit failed although attempt 2 was in flight.

## Root cause
The refund was modelled as one state transition plus one provider call, with nothing that
re-drives the call when the process loses its answer. `mark_booking_deposit_paid` returned
`duplicate` for any second delivery, so the one natural retry (Stripe's redelivery) was swallowed.
Refund ids were stored on the deposit only (current attempt), so an older attempt's id could not
be told apart from an unknown one.

## Fix (97fa5a85)
- `handle-payment-event.ts`: a redelivered payment that finds a late refund `refund_pending` with
  no refund id re-drives it with the SAME attempt, so the same idempotency key
  `refund:<deposit>:<attempt>` (a refund the provider did make comes back, not a second one).
- `redrive-stalled-refunds.ts` in `/api/cron/booking-reminders`: `refund_pending` rows with no
  refund id older than 10 min by the database clock (`stalled_booking_deposit_refunds`) are
  re-driven with the same attempt. Stripe's `charge_already_refunded` (key window passed) is read
  as `already_refunded` -> refunded.
- `booking_deposit_refund_attempts` (097): one row per attempt with the refund id it got, recorded
  as soon as the provider returns it (`record_booking_deposit_refund_ref`). A webhook settles only
  through the attempt that recorded its id; an older attempt's success still ends refunded.
- Tests: `src/application/payments/__tests__/refund-redrive.test.ts`, the finding 1/2 DB tests in
  `src/infrastructure/supabase/__tests__/booking-deposits.db.test.ts`.

## Prevention
- Every provider call that moves money has a sweep that re-drives it from the database's own
  state, with the same idempotency key, and a test that kills the process between claim and call.
- A webhook settles the object it names (a refund id), never the parent it hangs off.
- W6-fix found what this fix still missed (F1, F2, F4: next journal,
  `2026-11-28-book-014-refund-settlement-w6-fix.md`).
