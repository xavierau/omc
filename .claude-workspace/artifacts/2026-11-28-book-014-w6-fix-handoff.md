---
id: artifacts/2026-11-28-book-014-w6-fix-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-28
status: active
item: BOOK-014-W6-fix
state: done
brief: inline (team-lead dispatch, BOOK-014-W6-fix)
base: 7defecb054354c8b07bf96d5ab7aeb001f7a0b8c
head: see pushed tip   # 50a7e177 (F1 F2 F4 F6 F7), 5cba3063 (F3 G1 G2 G3), e3e38123 (F5), then the docs commit (F8 journals, this file, kanban, evidence)
branch: feature/book-014-core
pushed: true
pr: https://github.com/xavierau/omc/pull/237   # into develop, not merged
stage: poc
gate: {result: pass, note: "resource-lock heavy (foreground command; the harness moved it to the background at its 10 min tool timeout while it queued on the lock): TSC_OK, BUILD_OK, full vitest 773 files passed / 20 skipped, 9110 tests passed / 188 skipped / 2 todo, gate exit 0 (ac3-gate.log). eslint on the 39 touched .ts files: exit 0, 0 messages (ac3-eslint-touched.log)."}
next: {owner: team-lead, action: "re-review the W6-fix diff (review_focus), then W6b Stripe test-mode walk"}
blockers: []
refs: [specs/2026-11-27-book-014-booking-deposits, threats/2026-11-27-book-014-booking-deposits, artifacts/2026-11-28-book-014-w6a-handoff, kanban:BOOK-014]
---
ac:
  AC-1:
    result: pass
    evidence: "AC-1 command: 128 files / 2012 tests green, exit 0 (evidence/2026-11-28-book-014-w6-fix/ac1-green.log). Red first: the new tests run before the use-case code: 25 failed / 51 passed across the 5 new/changed files (ac1-red.log). Note: the red run was taken after the port, fake, adapter and 097 edits but before the use cases, /p, agent and text changes, so F1's red is the handler not handling payment_refunded, not the old SQL path."
    tests_by_finding:
      F1: "w6-fix-refund-states.test.ts 'F1 pending refund + charge.refunded -> still refund_pending, then refund.updated failed -> refund_failed'; 'F1 a refund_failed deposit (an attempt of ours) is not marked refunded by charge.refunded; Retry finds it already refunded'. stripe-gateway.test.ts: charge.refunded -> payment_refunded (fullyRefunded true/false)."
      F2: "'F2 late refund_failed re-driven with a new attempt and key, backoff 15 min x4, stops at the cap (5)'; 'F2 a retry that succeeds ends refunded'; 'F2 a retry whose refund is pending ... the refund event settles it'; 'F2 the last attempt failing by webhook is logged at the cap too'; 'F2 a staff-path refund_failed is NOT retried by the sweep'."
      F3: "route-w6-fix.test.ts 'F3 /p awaiting past the hold{,?return=success,?return=cancel} -> checking state, never \"will be refunded\"'; 'F3 a payment Stripe accepted in that window is paid'; 'F3 the lapsed page shows only once the deposit is actually lapsed'."
      F4: "'F4 refund.updated before recordRefundRef -> 503 + claim released, then the redelivery settles it'; 'F4 a refund id of an earlier attempt still changes nothing (200 duplicate)' (guard, green before and after)."
      F5: "agent-booking-deposit.test.ts 'F5 plan changed (deposit -> none ...)', '(none -> deposit ...)', '(amount) ...' -> deposit_terms_changed + re-propose, no hold, no booking, no provider call; 'F5 a proposal stored before W6-fix ... is booked as today'."
      F6: "'F6 older account event skipped ...' (memory store); merchant-payment-account-store.test.ts (query shape); stripe-gateway.test.ts 'occurredAt is the event's created time'."
      F7: "'F7 dashboard refund of a paid deposit -> refunded/provider (provider_dashboard), and Keep -> conflict (409)'; '... booking still going ahead also moves'; '... still pending, or only partial, is logged and changes nothing'; '... cannot confirm the refunds -> 500, claim released'. stripe-gateway.test.ts confirmFullyRefunded (true only when charge.refunded and every listed refund succeeded, one page)."
      G1: "agent-hold-lapsed.test.ts zh-HK and en assert the new sentence and the absence of 'nothing was charged' / 未有收取任何款項."
      G2: "'G2 declined + paid -> \"Your deposit will be refunded\" (booking-pay-refund-due), never \"Deposit paid\"'."
      G3: "'G3 details read throws -> \"We couldn’t load this payment\" (booking-pay-unreadable)'; 'G3 the details read finds no booking -> the same neutral state'."
  AC-2:
    result: pass
    evidence: "scripts/book-014/scratch-db.sh up: 97 migrations (001..097), ON_ERROR_STOP, exit 0, 0 errors, 1 NOTICE (097 DROP TRIGGER IF EXISTS) (db-scratch-up.log); the 3 new functions present (db-new-functions.log). With PostgREST (scratch-db.sh rest): booking-deposits.db 39 (32 before + 7 W6-fix: F1 no-id settles nothing x2, F4 attempt_of, F7 settle once + Keep 0, F7 other states untouched, reason CHECK, F2 backoff/cap, F2 staff never claimed + 3 concurrent sweeps claim once; R58 grants list extended with the 3 new functions), merchant-account-order-postgrest.db 2 (F6 last_webhook_at through real PostgREST), agent-booking-deposit.db 7 -> 48 passed (db-tests.log). Other booking DB tests: agent-booking, agent-booking-changes, booking-room, booking, booking-cron 45 passed / 3 skipped (db-tests-other.log), as in W6a. Containers removed after."
  AC-3:
    result: pass
    evidence: "ac3-gate.log: python3 ~/.claude/bin/resource-lock.py heavy -- sh -c 'npx tsc --noEmit && echo TSC_OK && npx next build && echo BUILD_OK && npx vitest run | tail -25': TSC_OK, BUILD_OK, 773 files passed | 20 skipped, 9110 tests passed | 188 skipped | 2 todo, gate exit 0. Caveat: the vitest stage was piped through tail, so its own exit code was not the gate's; the summary shows 0 failed files. eslint on every touched file: 0 messages (ac3-eslint-touched.log); the 36 pre-existing errors elsewhere were not re-measured this round (no file of theirs changed)."
  AC-4:
    result: pass
    evidence: "ac4-push.log: rtk proxy git push origin feature/book-014-core; ls-remote refs/heads/feature/book-014-core == HEAD; gh pr view 237 mergeable state recorded there; PR comment lists finding -> commit -> test."
decisions:
  - "F2 cap and backoff: 5 attempts in all (1 automatic + 4 sweep retries); the next is due 15 min x 4^(attempts-1) after the CURRENT attempt was claimed (booking_deposit_refund_attempts.created_at, DB clock): 15 min, 1 h, 4 h, 16 h (about 21 h). Claimed as a new attempt under FOR UPDATE SKIP LOCKED, actor cron; a crash before the call leaves a stalled refund_pending row the existing sweep re-drives. At the cap: deposit.late_refund_gave_up (error, depositId, attempts) once, whether the last attempt failed synchronously or by webhook."
  - "F4: outcome 'retry_later', HTTP 503 {error: retry_later}, claim released. The attempt lookup runs BEFORE finishRefund, so an id recorded in between is never misread as an earlier attempt's. Only refund_pending deposits; a refund_failed or settled deposit with an unknown id stays a 200 duplicate."
  - "F7: the adapter reads it (PaymentGatewayPort.confirmFullyRefunded): Stripe payment_intents.retrieve(expand latest_charge) for charge.refunded, then refunds.list(payment_intent, limit 100); true only with >=1 refund, all succeeded, no further page. Stripe docs (Context7): charge.refunded fires on refund creation incl. partial, refunds is expandable only. Only status paid with refund_attempts = 0 moves (settle_provider_refunded_booking_deposit); kept, refund_* and awaiting are logged, unchanged. A failed confirm call throws -> 500, claim released, Stripe retries."
  - "F1 consequence: a refund_failed deposit that was in fact refunded (call errored after Stripe made it, or refunded in the dashboard) is no longer healed by charge.refunded. It heals on the next attempt: Retry (staff) or the F2 sweep (late) gets Stripe's charge_already_refunded -> refunded, no second refund. Two pre-existing tests asserted the old healing (payment-threats R56 'provider later confirming ... ends refunded', refund-redrive finding 2 'no refund id is provider truth') and one DB assertion (note-once: finish(NULL,NULL) -> 1). Per the F1 ruling they now assert no change, then Retry -> refunded. Flagged here because escalate_if names weakening a test I did not write; these are ruling reversals, each still asserts the money outcome."
  - "F3: checking for awaiting past the hold regardless of ?return (cancel would otherwise show 'you have until HH:MM' + Pay now after the hold). Within the hold ?return=success keeps W3's 'Confirming your payment'. Three pre-existing tests advanced past the hold without lapsing and expected 'lapsed'; they now run the lapse first (same 410 neutral assertions)."
  - "G2/G3 copy: refund_due 'Deposit to be refunded' / 'Your deposit will be refunded. Message us on WhatsApp if you have questions.' (訂金將會退回 / 你的訂金將會退回。如有疑問，請在 WhatsApp 聯絡我們。). unreadable 'We couldn’t load this payment, please message us on WhatsApp.' (未能載入此付款資料，請在 WhatsApp 聯絡我們。), status 200, no details; typographic apostrophe because the page escapes ' to &#39;. A null details row is treated as a failed read for paid deposits. Without a details reader wired (W1 composition) paid still reads paid."
  - "F5: plannedDeposit {amountMinor, currency} | null on the create proposal; compared in createWithDeposit against the plan from the SAME account read startDeposit then uses. Changed -> {error: deposit_terms_changed, proposed: true, booking, deposit?, note} and the re-proposal is saved (made confirmable when the reply reaches the diner, as any proposal). Proposals without the field (stored before deploy, 30 min TTL) are not checked."
  - "F6: only account_updated is ordered; a deauthorization always applies (terminal). The return-page refresh writes no last_webhook_at. Equal timestamps apply (Stripe's created is whole seconds)."
  - "G1 text: en 'Your table hold for N on D at T has lapsed because the deposit was not paid in time. If a payment went through, it will be refunded in full automatically. Reply to this message to start again.' zh-HK '…因為未有在時限內付訂金。如已付款，款項將會自動全數退回。如想重新訂座，請回覆此訊息。'"
invariants:
  - "A deposit reaches refunded only from a refund id we recorded, the provider's already-refunded answer to one of our attempts, or (no attempt of ours, paid) a provider-confirmed full refund."
  - "A late-payment refund is never silently stranded: retried to the cap, then an error line."
  - "/p never promises a refund for a deposit that is not lapsed or refunding, and never says Deposit paid when the booking could not be read or was declined."
  - "The AI agent never charges or skips a deposit the diner did not agree to."
unverified:
  - "No real Stripe call: confirmFullyRefunded, the 503 redelivery and the dashboard-refund path are proven on the test adapter and a stubbed Stripe HTTP client only (W6b)."
  - "Stripe also sends refund.failed; the endpoint subscribes refund.updated only (unchanged). Whether refund.updated always accompanies a failure was not checked live."
  - "A dashboard refund on a deposit that staff already Kept (kept, attempts 0) is logged and left kept (the brief named paid only)."
  - "testid registry (.claude-workspace/ui-map/testid-registry.md) is outside files_allowed: booking-pay-checking, booking-pay-refund-due, booking-pay-unreadable still need their row added there."
  - "Commits are grouped by area, not one per finding (shared ports, 097 and fakes); each finding maps to its commit in the PR comment."
review_focus:
  - "supabase/migrations/097_booking_deposits.sql: finish NULL/NULL branch, claim_late_booking_deposit_refund_retries, settle_provider_refunded_booking_deposit, booking_deposit_refund_attempt_of, reason CHECK"
  - "src/application/payments/handle-payment-event.ts onRefundEvent (F4 order) and onPaymentRefunded (F7)"
  - "src/application/payments/redrive-stalled-refunds.ts + late-refund-retries.ts"
  - "src/application/payments/resolve-payment-link.ts paidState / checking"
  - "src/application/agent/agent-booking-deposit.ts createWithDeposit + agent-booking-tools.ts reproposeForNewDeposit"
scope_drift: []
in_flight: []
