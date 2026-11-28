# 2026-11-28 BOOK-014: every deposit returned by a deposit RPC lost its fields

## Problem
On the W4 local walk (real Postgres + PostgREST), declining a paid booking left the deposit in
`refund_pending`: the app logged `deposit.refund_failed code not_refundable`, then
`finish_booking_deposit_refund: Could not find the function ... (p_actor_kind, p_deposit_id, p_outcome, p_refund_ref)`.
No refund ever reached the provider. Staff Refund / Retry and the late-payment refund take the same path.

## Root cause
`booking-deposit-repository.ts`: `rpcDeposits()` already maps each snake_case row to `BookingDeposit`;
`firstDeposit()` then ran `toBookingDeposit()` again on the mapped object. Only `id` and `status`
share a name in both shapes, so `providerPaymentRef`, `refundAttempts`, `providerAccountId`, the
amount and the rest came back `undefined`. `issueRefund` saw no payment ref (`not_refundable`) and
sent `p_attempt: undefined`, which JSON drops, so PostgREST found no 4-argument overload.
Every unit test used the in-memory ledger, and the real-PostgREST DB tests were skipped (no
LOCAL_REST), so nothing exercised this mapping. Shipped in W1 (e7a7226e), kept by the W1 fixes.

## Fix
`firstDeposit(deposits: BookingDeposit[])` returns `deposits[0] ?? null` (W4 branch). Regression
test: `src/infrastructure/supabase/repositories/__tests__/booking-deposit-repository.test.ts`
(recorded PostgREST rows through beginRefund / finishRefund / keep / attachSession; red before the fix).

## Prevention
- A repository that maps RPC rows gets a test on the real row shape, not only on fakes
  (memory `incident_int001_fakes_hid_schema_mismatch`: same class of bug).
- Typed the helper on `BookingDeposit[]`, so passing raw rows (or mapping twice) no longer compiles.
- One real-PostgREST walk per money path before release; the walk caught it on its first decline.
