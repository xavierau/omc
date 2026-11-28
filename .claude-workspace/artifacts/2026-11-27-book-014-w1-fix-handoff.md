---
id: artifacts/2026-11-27-book-014-w1-fix-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-27
status: active
item: BOOK-014-W1-FIX
state: done
brief: inline (team-lead dispatch, BOOK-014-W1-FIX)
base: fb6d6f5c4561f662fedaa552410b4762c1edc689
head: 97fa5a85c9fa38d4e9f363091da8c24dd13517fa   # fix commit; this file lands in the next commit
branch: feature/book-014-core
pushed: true
pr: https://github.com/xavierau/omc/pull/237   # into develop, not merged
stage: poc
gate: {result: pass, at: 2026-11-27T15:55Z, note: "tsc clean; vitest 743 files / 8781 tests passed, 167 skipped; every touched file lints clean (26 files, eslint exit 0)"}
next: {owner: team-lead, action: "re-review PR #237 on the money path (097 finish/record/stalled RPCs, issue-refund, handle-payment-event duplicate re-drive), then W2"}
blockers: []
refs: [plans/2026-11-27-book-014-booking-deposits, threats/2026-11-27-book-014-booking-deposits, artifacts/2026-11-27-book-014-w1-handoff, kanban:BOOK-014]
---
ac:
  AC-1: {result: pass, evidence: "evidence/2026-11-27-book-014-w1-fix/ac1-red.log (15 new/changed tests failing first, each on its own assertion) -> ac1-green.log (8 files / 95 tests). New tests: application/payments/__tests__/refund-redrive.test.ts (1) late refund re-drive with the same key after refund-throws + finish-throws; (2) sweep re-drives stale null-ref row, skips fresh and with-ref; (3) already refunded -> refunded; (4) attempt 1 re_1 failed, Retry, delayed re_1 failed -> no change, attempt 2 -> refunded; (5) older attempt succeeded -> refunded, Retry then conflict; route.test.ts (6) chunked 300 KB no Content-Length -> 413, pulled < 300 KB, stream cancelled; stripe-gateway.test.ts (7) staff hold <= session expiry at lags 0..59 s, (1c) charge_already_refunded mapping; payment-threats R49 (8) unknown session -> ignored + info payment.unrelated_session; cron route test for the sweep step"}
  AC-2: {result: pass, evidence: "evidence/2026-11-27-book-014-w1-fix/db-scratch-up.log (fresh container, 97 migrations incl. develop's 096, 0 errors); db-tests.log (36 passed: booking-deposits.db 27 incl. new finding-2 attempt matching x3, finding-1 late attempt + stalled list, created_by through insert_booking_request_if_room, NULL-phone staff rows past the cap with notify_diner false, grants on the new RPCs/table; agent-booking-changes.db 9 incl. AC-R24; 3 skipped = real-PostgREST block, needs LOCAL_REST); db-tests-existing-booking.log (booking 9, booking-cron 6, booking-room 8, agent-booking 13, all green)"}
  AC-3: {result: pass, evidence: "evidence/2026-11-27-book-014-w1-fix/gate-ac3.log: TSC_OK; 743 files / 8781 tests passed. Round 1 (gate-ac3-r1.log) failed on a TS cast in the new route test and then the old 24 h staff-hold expectation in booking-deposit-domain.test.ts; both fixed, one rerun"}
  AC-4: {result: pass, evidence: "git ls-tree HEAD supabase/migrations | tail -2 -> 096_booking_staff_phone_optional.sql, 097_booking_deposits.sql"}
  AC-5: {result: pass, evidence: "plain push (no force), ls-remote SHA == HEAD; PR #237 body edited (apply migration 097, review fixes listed); gh pr view 237 mergeable MERGEABLE"}
decisions:
  - "attempt storage: a table booking_deposit_refund_attempts (deposit_id, attempt PK; refund_ref; UNIQUE (deposit_id, refund_ref)); begin and the late path insert the attempt row, record_booking_deposit_refund_ref fills its id (first id wins), booking_deposits.refund_ref stays the current attempt's id"
  - "issueRefund records every returned refund id (pending, succeeded, failed) before finishing, so a finish failure still leaves the id matched and the sweep skips the row"
  - "a refund webhook with no refund id (Stripe charge.refunded = fully refunded) stays provider truth: refunded from refund_pending or refund_failed; a failure without an id changes nothing (it cannot be attributed)"
  - "an unknown refund id changes nothing, even on a refund_failed row; such a refund is settled by charge.refunded (no id) or by Retry answering already_refunded"
  - "sweep: STALLED_REFUND_AFTER_MS 10 min, batch 50, 5 at a time, DB clock (stalled_booking_deposit_refunds); one row's error is logged and the batch continues; a failed re-drive ends refund_failed so a row is swept until it gets an answer"
  - "port: RefundResult gains {refundRef: null, status: 'already_refunded'}; Stripe maps only charge_already_refunded to it (amount_too_large stays rejected)"
  - "sessionExpiry rounds UP to the second (Math.ceil), otherwise a ms-precision hold could outlive its session by < 1 s"
  - "097 NULL phone: skips the per-phone cap and forces notify_diner false (096's booking_requests_no_phone_no_notify would refuse the insert otherwise); 096's staff_create/update_booking untouched"
  - "log fields: payment.unrelated_session {eventId, sessionRef} info; deposit.late_refund_redriven, deposit.refund_redriven, deposit.refund_redrive_failed, deposit.refund_already_refunded"
failed:
  - tried: "existing DB suites with the deposit test's PGPORT only"
    why: "booking.db / booking-cron.db / agent-booking.db default PGUSER to $USER and PGDATABASE to scratch_book001"
    evidence: "db-tests-existing-booking.log"
    replaced_by: "PGUSER=postgres PGPASSWORD=postgres PGDATABASE=postgres"
invariants:
  - "a refund is re-driven only with its current attempt (same key refund:<id>:<attempt>); a new key only comes from staff Retry"
  - "finish_booking_deposit_refund takes the deposit row lock; lock order deposit row then booking row unchanged"
  - "no Stripe type outside src/infrastructure/payments/stripe/** (payment-boundary.test.ts still green)"
unverified:
  - "Stripe's answer to refunds.create when an earlier refund on the charge is still PENDING past the 24 h key window: assumed amount_too_large (-> refund_failed, Retry), not charge_already_refunded; if Stripe answered charge_already_refunded there and the pending refund later failed, the deposit would read refunded wrongly. No live Stripe call was made: owner / W2 release check"
  - "concurrent re-drive with the same key while the first call is in flight: Stripe answers idempotency_key_in_use, which maps to rejected -> refund_failed; the winning call's id is still recorded and charge.refunded / refund.updated then ends it refunded. Converges, but staff may briefly see Retry: team-lead"
  - "NewBookingRequest.phone is still typed string; W4's NULL-phone staff deposit booking will need it widened (the SQL already handles NULL): W4"
  - "plans/2026-11-27-book-014-booking-deposits.md (lines 52, 60) and INDEX.md's plan line still say migration 096; planning artifacts are the main thread's, not edited here: team-lead"
  - "W1 evidence logs (evidence/2026-11-27-book-014-w1/) still name 096: they record what ran then and were left as is"
  - "red_first not observed for the new DB tests (the scratch DB was built once, after the 097 edits)"
review_focus:
  - "supabase/migrations/097_booking_deposits.sql: booking_deposit_note_refund_ref, record_booking_deposit_refund_ref, finish_booking_deposit_refund (rewritten), stalled_booking_deposit_refunds, the NULL-phone branch of insert_booking_request_if_room"
  - "src/application/payments/handle-payment-event.ts lateRefundNeverIssued"
  - "src/application/payments/issue-refund.ts record-before-finish order"
  - "src/app/api/webhooks/payments/stripe/route.ts readBodyCapped"
scope_drift: []
in_flight: []
next_step: "Re-review PR #237's money path, then dispatch W2."
