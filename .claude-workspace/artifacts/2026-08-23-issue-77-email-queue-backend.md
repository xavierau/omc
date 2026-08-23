---
id: artifacts/2026-08-23-issue-77-email-queue-backend
type: artifact
author: senior-backend-dev
created: 2026-08-23
status: active
supersedes: null
superseded_by: null
related: [kanban:ISSUE-77]
---

# Issue #77: Contact-form email sending moved to a BullMQ `email-send` queue

## Files Changed

| File | Lines | Purpose |
|------|-------|---------|
| `src/infrastructure/queue/email-queue.ts` | +90 (new) | Queue plumbing — `EmailJobData`, `addEmailJob`, worker lifecycle. Modelled on `receipt-queue.ts` verbatim shape. |
| `src/infrastructure/queue/email-job-processor.ts` | +100 (new) | Job-processing logic split out for SRP/testability: Result→throw translation, permanent-vs-transient classification, dead-letter alerting. |
| `src/app/api/webhooks/whatsapp/contact-form-handler.ts` | ~40 changed | `sendNotification` now builds `EmailJobData` and calls `addEmailJob` (after `sendAck`) instead of `getEmailProvider().send()` directly; enqueue failure caught → `contact_form.enqueue_failed`, never throws. |
| `scripts/start-worker.ts` | +7 | Registers the `email-send` worker in `startAll()` / `activeWorkers()` alongside campaign/event-dispatch/receipt for clean SIGTERM drain. |
| `src/infrastructure/queue/__tests__/email-queue.test.ts` | +115 (new) | `addEmailJob` job shape/options; worker wiring delegates to `processEmailJob` / `handleExhaustedRetries`. |
| `src/infrastructure/queue/__tests__/email-job-processor.test.ts` | +195 (new) | Result→throw translation, submittedAt-not-"now", permanent/transient split, dead-letter alerting, exhausted-retries alerting. |
| `src/app/api/webhooks/whatsapp/__tests__/contact-form-handler.test.ts` | rewritten (email-related assertions only) | Swapped `getEmailProvider`/`sendEmail` mocks for `addEmailJob`; added an enqueue-failure test. |

## Key Decisions

- **Split queue plumbing from job logic** (`email-queue.ts` vs `email-job-processor.ts`). The other three queues keep the job body inline (`receipt-queue.ts`, `campaign-queue.ts`) or a thin inline helper (`event-dispatch-queue.ts`'s `buildDomainEvent`/`handleFailedJob`), but this job needed Result-inspection + a permanent/transient split + alerting — enough logic that inlining it would have pushed `email-queue.ts` well past the 150-line new-file target and mixed two responsibilities. `application/process-receipt.ts` / `application/execute-campaign.ts` are the precedent for "queue file delegates to a processing function"; I kept the delegate in `infrastructure/queue/` rather than `application/` because it needs `EmailJobData` (the BullMQ job envelope type), and generalizing it into a reusable application use-case wasn't asked for (YAGNI).

- **`EmailJobData` has no `labels` field, per the issue's interface used verbatim.** `buildContactEmail` needs `ContactLabels` to build the email body, so the worker re-fetches `getContactConfig(restaurantId)` (never throws, per its own doc comment) for labels only — `notificationEmail` still comes from the job payload as the issue specified, not from this re-fetch. This is a deliberate, documented deviation from "carry everything so the worker does no guessing": labels are current tenant config, not a point-in-time fact like `submittedAt`, so using the config at send time is arguably more correct (a tenant who renames a label between submission and send sees the current name), and it keeps the job payload matching the issue's interface exactly. Flagging this as a design read worth a second opinion in review — the alternative (add `labels: ContactLabels` to `EmailJobData`) is a one-line change if reviewers prefer avoiding the extra DB round-trip per job.

- **Permanent-vs-transient split** (`isPermanentFailure` in `email-job-processor.ts`): `resend_not_configured` → permanent (missing env, not fixable by retrying); `resend_non_2xx` → permanent only for 4xx status parsed out of `error.details` ("HTTP nnn: ..."), **except 429** which stays transient (rate-limiting, not a rejected request — backoff is the correct response); `resend_timeout` / `resend_send_error` / `resend_no_message_id` → transient. Permanent failures throw `bullmq`'s `UnrecoverableError`, which moves the job straight to `failed` without burning the configured `attempts` — the exact mechanism the issue asks for ("do NOT burn retries").

- **Observability**: permanent failures call `notifyOpsAlert` (kind `engineering_alert`, routes to the platform team per `ops-alert.ts`) plus a `console.error('[EmailQueue] dead_letter', ...)`, before throwing `UnrecoverableError`. `notifyOpsAlert` is documented never to throw, but I wrapped the call in try/catch anyway as belt-and-suspenders — a regression there must not turn a should-be-dead-lettered job into a different, retried failure. A second call path, `handleExhaustedRetries` (wired to the worker's `'failed'` listener, mirroring `event-dispatch-queue.ts`'s existing `handleFailedJob` pattern), fires the same alert when a *transient* failure exhausts all configured attempts — so both "permanent from attempt 1" and "kept failing until retries ran out" end up alerted exactly once, with no double-alert (it explicitly skips `UnrecoverableError` instances, since those already alerted before throwing).

- **`jobId: messageId`** for enqueue-side dedupe, `removeOnComplete: { count: 100 }` / `removeOnFail: { count: 1000 }` per the task's note that a parallel PR standardizes these values on the other three queues — matched here, not applied to the other queue files (out of boundary).

## Tests

68 new/updated tests, all passing:
- `email-job-processor.test.ts` — 20 tests (Result→throw translation, submittedAt fidelity under fake timers, 4xx/5xx/429 classification table, dead-letter + exhausted-retries alerting, alert-throws-but-still-dead-letters).
- `email-queue.test.ts` — 6 tests (job shape/name/options, worker delegates to the processor, idempotent `ensureWorkerStarted`, `'failed'` listener wiring).
- `contact-form-handler.test.ts` — rewritten; all 12 existing scenarios pass with `addEmailJob` in place of the direct send, plus a new enqueue-failure scenario.

`./node_modules/.bin/tsc --noEmit` clean. `./node_modules/.bin/eslint` clean on all changed files. Full `vitest run`: 3348 passed, 5 failed — all 5 in `route.quality-event.integration.test.ts`, `route.status-event.integration.test.ts`, `route.template-status.integration.test.ts`, which pass cleanly (35/35) when rerun in isolation. This matches the pre-existing flaky-suite behavior documented in project memory (CI-001 / issue #92, shared-state pollution across the full run) — not caused by this change; no email-queue code is touched by or touches those suites.

## Deferred / Tech Debt

- **AC6 (`getEmailProvider()` only from the queue worker) formally re-scoped, not silently dropped.** `src/application/submit-contact-web-form.ts` (REPLY-008) still calls `getEmailProvider().send()` directly and synchronously — its failure contract is user-visible/retryable (`{ ok: false, reason: 'email_failed' }` back to the HTTP caller), unlike the fire-and-forget webhook path, so routing it through the queue needs its own async-failure-surfacing design. Per orchestrator direction: **follow-up issue #110** now tracks that conversion; the call site carries a comment pointing at it; PR #106's body states AC6 is re-scoped per #110 rather than met by this PR.
- Retrying a job whose original attempt actually reached Resend (e.g. a timeout where the request succeeded server-side) risks a duplicate email — `jobId` dedupe only prevents double-*enqueue*, not double-*send* across BullMQ retries of the same job, and Resend calls carry no idempotency key. `resend_no_message_id` (2xx with an unparseable body) is now classified **permanent** specifically to avoid this — see Review Round 2 below — but a genuine timeout/network error where the request actually landed server-side is still an at-least-once risk. Pre-existing risk class, not introduced or worsened relative to what queueing already trades off; worth a follow-up if Resend idempotency keys are wanted.
- No `events`-table audit row is written for a dead-lettered email (unlike `emit-ops-alert.ts`'s WhatsApp-error path, which writes one alongside the Slack alert). The issue offered "an ops alert... **or** at minimum a distinct log event" — I implemented both `notifyOpsAlert` and a structured `console.error`, plus (Review Round 2) `docs/playbooks/email-queue-ops.md` documenting how to inspect the failed set directly in Redis. A DB audit trail wasn't asked for and `emit-ops-alert.ts` is tightly coupled to `WhatsAppMessage` snapshot shape, so extending it would be its own change.

## Review Hand-off

- Please confirm the permanent/transient HTTP-status split (4xx permanent except 429, 5xx/network/timeout transient, plus `resend_no_message_id` now permanent) matches the intended operational posture.
- `submit-contact-web-form.ts` (REPLY-008) is a formally re-scoped gap against AC6, tracked as #110 — not a silent miss.

## Review Round 2 (PR #106 dual review: Gemini APPROVED, second lane CONDITIONAL)

Applied on the same branch/PR, in response to two Important findings plus minor asks from the coordinator:

1. **Redis-down enqueue hang (Important).** `maxRetriesPerRequest: null` + ioredis's default `enableOfflineQueue: true` meant a `q.add()` issued while Redis was down/still-connecting got silently queued awaiting reconnect — `maxRetriesPerRequest: null` lets that reconnect retry forever, so `addEmailJob` never rejected and the webhook response held open unboundedly (worse than the old inline send's 10s bound). Fixed by splitting the producer and worker Redis connections in `email-queue.ts`: the **worker** connection keeps `maxRetriesPerRequest: null` (required for its blocking commands); the **producer** (Queue) connection now sets `enableOfflineQueue: false` + a finite `maxRetriesPerRequest: 1` + `connectTimeout: 5000`, and `addEmailJob` additionally races a `withTimeout(..., 5000ms)` wrapper around `q.add()` as belt-and-braces so the enqueue path has a hard upper bound regardless of what ioredis does internally. Test added that proves the *realistic* failure mode — `mockAdd` returns a promise that never resolves (a hang, not a mocked rejection) — and asserts `addEmailJob` still rejects within the timeout window under fake timers. `receipt-queue.ts` shares the same latent one-connection-for-both posture; per explicit instruction this is pre-existing and NOT touched.
2. **AC6 re-scope (Important).** See Deferred section above — comment added at the `submit-contact-web-form.ts` call site, PR body updated to state AC6 is re-scoped per #110, no behavior change there.
3. **`resend_no_message_id` reclassified permanent (minor).** A 2xx with no parseable id means the request likely already reached Resend; retrying risked a duplicate send. Moved from the transient bucket to permanent in `isPermanentFailure` (one line + comment), test updated accordingly.
4. **`removeOnFail` age bound added (minor).** `{ count: 1000, age: 7 * 24 * 3600 }` — failed jobs carry submission PII and now age out after 7 days even if the count cap isn't hit. `removeOnComplete` left as `{ count: 100 }` (completed jobs carry the same PII briefly but at a much higher turnover, and the ask was specifically about the failed set).
5. **Ops note added (minor).** `docs/playbooks/email-queue-ops.md` — what the dead-letter alert means, how to inspect `bull:email-send:failed` (redis-cli and a `Queue.getFailed()` snippet), and a recovery note per failure class.
6. **Point-in-time recipient (optional, kept as-is).** Added a one-line rationale comment in `email-job-processor.ts`'s `sendEmail`: `notificationEmail` stays point-in-time from the job payload (unlike `labels`, which is re-fetched live) because a retry re-reading config could otherwise land a resend at an address the tenant switched to for unrelated reasons, with no context tying it back to this submission.

New/changed tests this round: 3 new (`email-queue.test.ts`: producer-connection-fail-fast, worker-connection-keeps-null, hang-bounded-by-timeout + a resolves-fast counterpart), 1 test reclassified (`email-job-processor.test.ts`: `resend_no_message_id` moved from the transient table to its own permanent assertion). Full suite after this round: 3357 passed, 0 failed (the previously flagged #92 flaky suites passed clean in this run — see Tests section above for the isolation-rerun evidence from round 1).
