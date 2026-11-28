# WAQ-011 send-time gate: misleading "platform approval" error (issue #117 / WAQ-014)

## Problem description

Tenant 釧 Kushiro's campaign "testing broadcast" sat in `failed` for ~4 weeks.
`failure_reason` said the template "requires platform approval before sending",
which reads as Meta/WhatsApp approval — so diagnosis went to Meta/Kapso, where
the template was APPROVED the whole time. The `bull:campaign-execution:failed`
queue filled to its 1000-entry cap with the same guardrail error.

## Root cause analysis

Two independent defects, neither in the gate's decision logic (which was correct):

1. **The message named the wrong system.** `checkTemplateReview` is an internal
   OhMyClient platform-admin gate (trusted-tenant policy + `template_review_queue`);
   it never consults Meta/Kapso. "Platform approval" pointed operators at the one
   system that was irrelevant.
2. **The decisive discriminator was discarded.** `checkTemplateReview` returns
   `trustReason` (`too_new` / `recent_quality_incident` / `auto_paused`) exactly so
   ops can tell why a tenant is untrusted — its own module header promises this —
   but `enforceTemplateReview` threw it away and emitted a generic string.

Kushiro was `too_new` (created 2026-05-26) with no review-queue row; it silently
self-healed when it aged past 90 days on 2026-08-24. Nothing was ever broken on
the Meta side. Contributing discoverability gap: the submit affordance lives on
the WhatsApp Templates page, not the campaign card, and scheduled campaigns never
pass the card's gate hint — `template_review_queue` had zero rows platform-wide.

## Solution implemented (PR #118 → develop, #119 → main, released 2026-08-24)

`enforceTemplateReview` now builds a trustReason-aware message: names the cause
with a greppable `[trustReason=…]` token, states the approver is an OhMyClient
platform admin, front-loads "NOT WhatsApp/Meta template approval (Meta is not
consulted)" so the queue's `FAILURE_REASON_MAX_LEN` truncation can never chop it,
and points at `/dashboard/wa-templates` (submit) and `/admin/template-reviews`
(decide). Worst-case message measured 487/500 chars; template name clamped to 56
chars and control-char-stripped. `FAILURE_REASON_MAX_LEN` was hoisted to
`campaign-guardrail-error.ts` so the queue's truncation and the length-guard test
share one definition. Gate behavior unchanged; the string reaches
`campaigns.failure_reason`, the failed-campaign banner, and the execute route's
`violations[]` with no changes at those surfaces.

Deliberately NOT done: wiring the Kapso `message_template_status_update` webhook
into `template_review_queue` — Meta approval must never auto-satisfy the 90-day
trust gate (issue #117 forbids it; the two approvals answer different questions).

## Prevention measures

- Length-guard test asserts every variant stays within the shared
  `FAILURE_REASON_MAX_LEN`; test case table is exhaustive-by-construction over
  the `TrustReason` union, so a 4th reason cannot ship unworded or untested.
- Follow-ups on kanban WAQ-014: review-status-aware denial message (rejected vs
  pending vs not-submitted currently read identically — same failure class),
  `en.json:856` "pending platform approval" hint carries the same ambiguity,
  and proactive schedule-time/campaign-card discoverability for the submit flow.
- Class rule: a guardrail's error must name the system that made the decision and
  carry the discriminator it computed; it must never use wording that implicates
  a system it did not consult.
