---
id: artifacts/2026-11-28-book-014-w6a-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-28
status: active
item: BOOK-014-W6a
state: done
brief: inline (team-lead dispatch, BOOK-014-W6a)
base: 08ea74bed0d7e9be70b570cb5ee59b38e66a4b34
head: see pushed tip   # 7d98e2eb feature commit; this file, kanban and evidence in the next commit
branch: feature/book-014-core
pushed: true
pr: https://github.com/xavierau/omc/pull/237   # into develop, not merged
stage: poc
gate: {result: pass, note: "resource-lock heavy: TSC_OK, BUILD_OK (next build), full vitest 770 files passed / 19 skipped, 9069 tests passed / 179 skipped / 2 todo, gate exit 0 (gate-ac4.log); eslint 36 = 36 errors vs origin/develop, changed files clean (ac4-eslint-compare.log)"}
next: {owner: team-lead, action: "/code-review the combined diff (review_focus), then W6b Stripe test-mode walk"}
blockers: []
refs: [specs/2026-11-27-book-014-booking-deposits, threats/2026-11-27-book-014-booking-deposits, plans/2026-11-27-book-014-booking-deposits, artifacts/2026-11-27-book-014-w1-handoff, artifacts/2026-11-27-book-014-w4-handoff, artifacts/2026-11-28-book-014-w5-handoff, kanban:BOOK-014]
---
ac:
  AC-1:
    result: pass
    evidence: "merge-base --is-ancestor 67a77686, 710b46be and origin/develop (8d93704a) all true; git grep for conflict markers: none; ls supabase/migrations | tail -2 -> 096_booking_staff_phone_optional.sql, 097_booking_deposits.sql (ac1.log)."
    merges: "(1) 67a77686 fast-forward; (2) 710b46be merge 9866f1fd, 4 conflicts resolved (testid-registry both rows; booking-deps HEAD's superset import; submit-booking-request import union hasPhone + NewBookingRequest; payment-deps union + composed hook) and git's clean auto-merge of booking-config.ts left two deposit-rule import lines, W2's kept per ruling; (3) origin/develop merge, no conflicts. Lock vs develop: only stripe 23.1.0 moved (no npm install needed; npm ci to sync node_modules to next 16.4.6)."
  AC-2:
    result: pass
    evidence: "AC-2 command plus src/components/booking and the two touched repository tests: 152 files / 2259 tests green (ac2-green.log)."
    red_first: "Observed red before the implementation for everything but the paid hook: 11 failing + the lapse module missing (ac2-red.log). The composed paid hook was written during the merge, before its test; red reproduced after the fact by making depositPaidHook run W3's hook only: 3 of 5 fail (ac2-red-paid-hook-w3-only.log), 5/5 with both."
    tests_by_requirement:
      paid_hook: "src/application/payments/__tests__/deposit-paid-hook.test.ts: one test per source through the real webhook on the test adapter. chat -> pending + 'received' once; campaign -> 'received' once; agent (AI and PAP share source 'agent') -> pending + 'received' once; staff hold -> confirmed + 'confirmed' once, outcome recorded; all four in one world -> 4 messages, replaying all four -> still 4."
      ai_lapse: "src/application/payments/__tests__/agent-hold-lapsed.test.ts (8): AI hold lapses -> one zh-HK text with the slot, 'nothing charged', reply to start again, ends with the disclosure; en member -> English; second expiry run sends nothing; PAP, chat and campaign lapses send nothing; one send throws -> logged deposit.lapse_notice_failed once, the other diner still texted, batch result 2, next run sends nothing (no retry); booking read throws -> logged, booking still lapsed, batch result 1; nothing lapsed -> no read; provider 'session expired' event -> same text once, replay none."
      lapse_reader: "src/infrastructure/supabase/repositories/__tests__/lapsed-hold-booking-repository.test.ts (5): source=agent + in(id) only, personalAgent from status_token_hash (hash never returned), other-restaurant rows dropped, chunks of 50, error throws."
      p_held: "src/app/p/[token]/__tests__/route-details.test.ts W6a block: cancelled and no_show with a paid deposit -> booking-pay-held, zh-HK + en copy, details, never 'request sent'; confirmed -> still booking-pay-paid; refunded / kept on a cancelled booking keep W3's states. payment-link-details-repository.test.ts: select adds status (still no name, phone, notes), mapped as bookingStatus."
      b_terms: "src/components/booking/__tests__/booking-deposit-terms.test.tsx: depositPlanOf carries depositTermsText zh_hk/en; DepositTerms renders booking-deposit-terms zh-HK before en, nothing without a plan; the BOOK-001 form shows it while a deposit applies (also below N); no plan -> none."
      shared_sentence: "same file: with depositProcessingSentence mocked to a sentinel, CollectionStatement renders the sentinel in both languages (so the component calls the shared function); no deposit -> not rendered. The existing W3 statement tests still pass on the real wording."
      pap_statement: "src/application/booking/__tests__/agent-booking-create-statement.test.ts (4): rule on + chargeable account -> en = base + ' ' + depositProcessingSentence.en, zh-HK = base + sentence, privacy_url unchanged (also when the party is below N); restricted / no account / rule off / no reader -> the pre-BOOK-014 statement, equal."
      accounts_required: "HandlePaymentEventDeps.accounts required; the 'no store -> ignored' branch removed. tsc found two compositions without it (payment-world, the stripe-gateway attack test); both now pass a MemoryMerchantAccountStore. Production paymentWebhookDeps already passed merchantPaymentAccountStore."
  AC-3:
    result: pass
    evidence: "scripts/book-014/scratch-db.sh up: supabase/postgres 17.6.1.143, 97 migrations (001..097) applied with ON_ERROR_STOP, exit 0, 1 NOTICE (097 DROP TRIGGER IF EXISTS) (db-scratch-up.log); 096 applied (booking_requests.phone nullable YES, db-096-check.log). PostgREST via 'scratch-db.sh rest'. RUN_DB_TESTS=1 (db-tests.log, verbose): booking-deposits 32, agent-booking-deposit 7, agent-booking 13, agent-booking-changes 9 (+3 skipped: its real-PostgREST block needs NEXT_PUBLIC_SUPABASE_URL + a service key), booking-room 8, booking-room-postgrest 3, booking 9, booking-cron 6 -> 8 files, 87 passed, 3 skipped, 0 failed. Containers removed after."
  AC-4:
    result: pass
    evidence: "gate-ac4.log: tsc --noEmit TSC_OK; next build BUILD_OK; vitest run 770 files passed | 19 skipped, 9069 tests passed | 179 skipped | 2 todo; gate exit 0. ESLint (ac4-eslint-compare.log, eslint-base.txt, eslint-branch.txt, eslint-changed-files.txt): src exported by git archive from origin/develop and HEAD, linted with one command and the same node_modules: 36 errors / 13 warnings on both, identical (file, line, rule, severity) sets; the 180 added/modified src .ts/.tsx files have 0 messages."
  AC-5:
    result: pass
    evidence: "rtk proxy git push origin feature/book-014-core; ls-remote refs/heads/feature/book-014-core == HEAD (ac5-push.log). PR #237 body rewritten: W1-W5 + integration, stacked PR table (#239, #238, #242, #244) with every spec AC / R-id served, W6a items, checks, and Apply migration 097 before deploy; mergeable state recorded in ac5-push.log."
decisions:
  - "Paid hook: depositPaidHook runs W3's and W5's hooks in turn; each filters on its own sources (chat/campaign vs agent/staff), so a booking matches at most one. PAP and the AI agent both have source 'agent' and both get 'received' (D2 stands)."
  - "AI-agent lapse: an AI booking is source 'agent' with no status_token_hash (PAP create always sets one; the AI tools never do). The text is one language, the diner's (member preferred language, else zh-HK, as the booking sender picks it), with the tenant's AI disclosure (R11, as the link text). Sender: getRestaurantPhoneNumberId + sendTextMessage, exactly agent-deps notifyText."
  - "AI-agent lapse is also wired on the provider's 'session expired' webhook path (HandlePaymentEventDeps.onLapsed), not only expireDeposits: the Stripe session can expire before the 5-minute cron reaches the hold, and that path lapses the same holds. Without it the text would be missed whenever the webhook wins. Sent once either way: the lapse RPC returns a deposit only to the call that lapsed it."
  - "Lapse hook failures: a booking-read failure logs deposit.lapse_notice_failed {count}; a per-diner failure logs {bookingId}; the hook itself is also wrapped (deposit.lapse_hook_failed). No retry, nothing thrown into the batch or the webhook."
  - "/p held: deposit 'paid' + booking cancelled or no_show (KEEPABLE_BOOKING_STATUSES). It needs the booking status, so the details read now selects status too (not shown on the page)."
  - "/b terms: DepositPlan gains optional terms (depositTermsText per language), built by depositPlanOf on the server; DepositTerms (booking-deposit-terms) sits above the deposit line in both forms and shows whenever a plan exists, also before the party reaches N, since it states the rule."
  - "PAP statement: createAgentBooking reuses W5's documentDeposit (now exported from agent-booking-settings.ts), so 'deposit active' means the same as for poppy.json/OpenAPI. The sentence is appended to the en and zh-HK strings; the CollectionStatement schema is unchanged. A failed account read leaves the sentence out and logs (create never fails on it)."
  - "W3's booking-page-deposit test expectation extended with the new terms field (additive; nothing removed)."
invariants:
  - "Every paid booking sends at most one diner message; a replayed or late event sends none (W1 CAS + webhook idempotency)."
  - "The lapse text is sent only for source 'agent' without a status token, only once per lapse, and never blocks expiry or the webhook answer."
  - "/p never says 'request sent' for a cancelled or no-show booking whose paid deposit is undecided."
  - "One Stripe processing sentence (depositProcessingSentence) for /b, the agent texts, poppy/OpenAPI and the PAP create statement."
unverified:
  - "#242 and #244 target feature/book-014-w2-admin and feature/book-014-w4-staff, whose tips do not contain their heads, so GitHub may not mark them merged after this push (the brief expected all four). Not closed or merged by hand."
  - "/p held relies on the details read; if that read fails the page falls back to 'Deposit paid' (W3's best-effort behaviour), which says 'request sent' for that one view."
  - "A declined booking whose paid deposit has not reached refund_pending yet (the decline refund call failed before the CAS) still reads 'Deposit paid'; the brief named cancelled / no-show only."
  - "Lapse text: 'nothing was charged' is wrong in one race: a payment Stripe completes just before the lapse but whose webhook lands after it is auto-refunded (AC-8). The text does not mention that refund."
  - "No real Stripe key, Kapso or Meta send: W6b."
review_focus:
  - "src/application/payments/deposit-paid-hook.ts + payment-deps.ts default onDepositPaid / onLapsed"
  - "src/application/payments/notify-agent-hold-lapsed.ts + lapsed-hold-booking-repository.ts (AI vs PAP discriminator, failure handling)"
  - "src/application/payments/handle-payment-event.ts onPaymentExpired hook call, accounts now required"
  - "src/application/payments/resolve-payment-link.ts held state"
  - "src/application/booking/create-agent-booking.ts depositProcessing"
scope_drift: []
in_flight: []
