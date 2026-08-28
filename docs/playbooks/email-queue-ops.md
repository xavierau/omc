# Ops Note — `email-send` Queue (ISSUE-77)

Audience: on-call / ops
Purpose: how to find and act on a contact-form notification email that failed to send.

---

## What the alert means

When an `email-send` job dead-letters — either a permanent failure (bad recipient,
unverified sending domain, revoked API key, or a 2xx response with no message id) or a
transient failure (timeout, network error, 5xx) that has exhausted its 3 configured
retry attempts — two things happen:

1. A Slack alert fires via `notifyOpsAlert` (`kind: engineering_alert`, routes to the
   platform channel per `src/domain/value-objects/ops-alert.ts`), with `restaurantId`,
   `messageId`, and the underlying error title/details.
2. A structured log line: `[EmailQueue] dead_letter { restaurantId, messageId, error }`.

The customer already received their WhatsApp ack (that leg is unaffected — see
`contact-form-handler.ts`'s file header). What's at risk is **the restaurant never
learning about the enquiry**, so the response is to get the notification to them by
other means, not to worry about the customer-facing side.

## Inspecting the failed set

BullMQ stores failed jobs under the `bull:email-send:failed` Redis key (sorted set),
retained up to `{ count: 1000, age: 7 days }` — whichever limit is hit first prunes the
rest, since failed jobs carry submission PII (name, phone, enquiry text) and shouldn't
sit in Redis indefinitely.

From a shell with `REDIS_URL` set to the production instance:

```bash
redis-cli -u "$REDIS_URL" ZRANGE bull:email-send:failed 0 -1
redis-cli -u "$REDIS_URL" HGETALL bull:email-send:<jobId>
```

Or, with a Node REPL / script using `bullmq`:

```ts
import { Queue } from 'bullmq'
const q = new Queue('email-send', { connection: { /* ... */ } })
const failed = await q.getFailed(0, 50)
for (const job of failed) {
  console.log(job.id, job.data.restaurantId, job.data.messageId, job.failedReason)
}
```

`job.data` is the full `EmailJobData` payload (recipient, submission, sender, original
submission timestamp) — enough to relay the enquiry to the restaurant manually while
investigating, and `job.failedReason` carries the thrown error message (permanent
failures are prefixed `email permanently failed (...)`; exhausted-retry failures carry
the last attempt's transient error).

## Recovery

- **Permanent failure** (bad recipient / unverified domain / revoked key): the tenant's
  `notificationEmail` config or the `RESEND_*` environment needs fixing first — retrying
  the same job will fail identically. Once fixed, `job.retry()` re-runs it, or relay the
  enquiry manually and let the job age out.
- **Exhausted-retries failure** on a since-recovered Resend outage: `job.retry()` is
  usually sufficient — the underlying condition may no longer apply.
