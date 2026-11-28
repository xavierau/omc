---
id: artifacts/2026-11-26-book-012-r2-review-fixes-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-26
status: active
item: BOOK-012
state: done
brief: inline (BOOK-012 r2, ruling r2b)
base: 998b5886
head: c0ac99a5 (code; the docs commit for this file follows it)
branch: feature/book-012-classifier-default-on
pushed: true
stage: poc
suite_changed: false
gate: {result: pass, at: 2026-11-26}
next: {owner: main, action: "re-review PR #230 (998b5886..HEAD), then owner go for release (migration 094 before restart)"}
blockers: []
refs: [pr:230, kanban:BOOK-012, artifacts/2026-11-26-book-012-classifier-default-on-handoff]
---
ac:
  AC-1: {result: pass, evidence: "RED commit c3620fd9 (route-booking-intent 3, book-routing 2, agent-routing 4 failing; the unchanged booking_reply retry cases already passed). Green after the fix: the 3 AC-1 files plus the 2 repository files, 5 files 124/124"}
  AC-2: {result: pass, evidence: "inbound-classification-repository.test.ts: a 23505 is followed by SELECT outcome WHERE restaurant_id, message_id and returns {status:'duplicate', earlierOutcome}; first delivery is one query; lookup error / no row / odd value → earlierOutcome null. booking-schema-contract.test.ts now also checks the repo's filter columns against the migrations SQL"}
  AC-3: {result: pass, evidence: "under resource-lock heavy, once each, at c0ac99a5: vitest 726 files passed, 17 skipped; 8422 tests passed, 140 skipped, 2 todo (34.8s). tsc --noEmit exit 0. No flaky WAQ reruns needed"}
  AC-4: {result: pass, evidence: "see the push log in the handoff block: rtk proxy git ls-remote equals HEAD; PR #230 body has an r2 review fixes line"}
decisions:
  - "Ruling r2b (main, 2026-11-26): files_allowed also covers src/test-utils/fake-intent-classifier.ts, only for FakeClassificationStore returning the stored outcome on a duplicate. That is the only change made there"
  - "Port: RecordClassificationResult became {status:'recorded'} | {status:'duplicate'; earlierOutcome: ClassificationOutcome | null} | {status:'failed'}. The outcome travels through record(), so routeBookingIntent needs no second port call"
  - "Round trips: PostgREST cannot return the conflicting row from a plain insert, and an RPC would need a migration (escalate_if). So the repo does one SELECT outcome only after a 23505. First deliveries stay at one round trip"
  - "Order kept: classify, then record (fixed item 2). A retry still calls the classifier, then record() reports the duplicate. Only the duplicate's return value changed"
  - "Retry decision (route-booking-intent.ts decideRetry): earlier booking_reply → {kind:'duplicate'} (send nothing, stop routing). fallback, error or null → {kind:'fallback'}, so handlers.ts goes on to maybeQueueAgentReply / handleUnknown, same as the classifier off. The agent and the fallback menu de-dup retries on their own, as they do today with the classifier off"
  - "Log: a duplicate logs booking.classified {messageId, recorded:'duplicate', earlierOutcome}. No text and no phone (R8)"
  - "094 rollback comment: names kushiro 96676002-4ba4-46cc-966c-061adc5d26f1 and bicho ('id: see release runbook GET-before'); its UPDATE uses the forward migration's rev CASE. The extracted SQL ran on a temp table on the local Postgres: rev 8→9, rev absent→1, a non-listed row untouched"
  - "book-handler.ts not changed: its fallback→false / duplicate→true mapping is already right once duplicate means 'answered before'"
failed: []
invariants:
  - "First delivery behaviour is unchanged (all pre-existing route/book/agent routing tests still pass unedited, except the repository test's expected return shapes)"
  - "A retry after a Book now reply still sends nothing and stops routing (route-booking-intent 'a replayed wamid → duplicate', book-routing W2-07, agent-routing '(r2) … booking_reply')"
unverified:
  - "Real Postgres duplicate path: the SELECT after 23505 is proven against the recording client and the schema contract, not against a live PostgREST"
  - "Bicho's id: not looked up (brief). Release runbook GET-before must supply it"
  - "A retry where the first delivery minted a chat token and then failed before record: unchanged pre-existing behaviour, not exercised"
review_focus:
  - "src/application/booking/route-booking-intent.ts decideRetry"
  - "src/infrastructure/supabase/repositories/inbound-classification-repository.ts findStoredOutcome"
  - "supabase/migrations/094_booking_ai_routing_default_on.sql rollback comment"
scope_drift:
  - "src/test-utils/fake-intent-classifier.ts, under ruling r2b"
  - "src/infrastructure/supabase/repositories/__tests__/booking-schema-contract.test.ts gains a filter-column check for the classification repo (inside src/**/__tests__/**)"
in_flight: []
next_step: "Re-review PR #230, then release with migration 094 applied before the app restart."
---

# BOOK-012 r2 handoff

Three review fixes on PR #230: the retry rule, the module comment, and the 094 rollback comment. There is no new migration and no schema change.

Failure the fix closes: the first delivery records outcome `fallback` or `error`. The process then dies before the agent stores the text, or the webhook is retried for some other reason. Before r2, the retry got `duplicate`, `maybeReplyToBookingIntent` returned true and `handlers.ts:203` returned, so the diner got nothing. Now the retry continues to the agent queue or the fallback menu, the same as a tenant with the classifier off.
