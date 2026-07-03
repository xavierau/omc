# Webhook 500 on no-sender events → Kapso retry storm (WH-001, issue #45)

## Problem

Production log (2026-07-03, 06:31–07:26 UTC): 129 webhooks, only 53 unique —
70 `duplicate` re-deliveries and 33 identical `webhook.error` events
(`Error: Invalid phone number: ` with an empty value) across text, image and
interactive messages. Kapso re-delivered the same events 3–4×, and the
affected messages were silently dropped.

## Root cause

Kapso sends message-shaped webhook events with no sender (`from`) —
status/echo events. The chain:

1. `webhook-parser.ts` `buildMessage` defaulted the sender:
   `from: (msg.from as string) ?? ''`.
2. `handlers.ts` called `PhoneNumber.create('')`, which throws
   `Invalid phone number: ` (< 8 digits).
3. `route.ts`'s catch-all converted the throw to **HTTP 500** — the signal
   Kapso treats as "retry me".
4. The idempotency key was claimed **before** processing, so after the first
   throw every retry short-circuited as `duplicate` → the event could never
   be reprocessed (permanent drop).

Invisible in logs because `maskPhone('')` renders `'***'`, identical to a
real masked number.

## Solution (PR #47)

Principle: **never return a retryable 500 for an event that can never
become processable, and never burn an idempotency key on an event we
won't process.**

- Parser: `buildMessage` returns `null` unless `from` is a non-blank string
  (a numeric `from` would otherwise throw inside the parser's own masked
  logging — pre-guard, no claim burned → infinite storm).
- Route: `hasRoutableSender` validates the phone (`PhoneNumber.create`)
  **before** `tryMarkProcessed`; unroutable senders ('', whitespace, `abc`,
  short digits) are 200-ignored.
- Malformed JSON returns 400 instead of 500 (can never become parseable).
- `verifyKapsoSignature` compares `Buffer.byteLength`, not string length —
  a multi-byte signature previously made `timingSafeEqual` throw →
  unauthenticated 500.
- Regression tests at parser level and route level, including a
  parser-stubbed suite so the route guard survives parser refactors.

## Prevention

- Adversarial review after the first cut found the storm class survived
  through three more doors (numeric sender, present-but-invalid sender,
  malformed JSON) — for webhook endpoints, enumerate **every** throw path
  between receipt and the idempotency claim, not just the reported one.
- Follow-ups on the board: WH-002 (ignored-event observability, raw payload
  capture, idempotency-before-processing), WH-003 (Meta `messages[0]`-only
  parsing), **WH-004 (signature verification fails OPEN when the secret is
  unset in production — decision needed)**, WH-005 (robustness bundle).
- Issue #45 stays open until develop → main promotion deploys the fix.
