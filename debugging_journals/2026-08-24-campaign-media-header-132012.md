# Campaign sends omit the media header component — Meta #132012, run reported `completed` (#127 / CAMP-007)

## Problem

Prod campaign "5 year annivesary test 2" (restaurant `96676002…`) sent nothing on
2026-08-24 ~14:16 UTC, yet the dashboard showed it `completed`. Worker log showed both
sends rejected by Meta: `(#132012) Parameter format does not match format in the created
template`, then `[Campaign] 2/2 sends failed` … `Job 6722 completed`.

## Root cause

Two independent defects compounding:

1. **The send path never builds a header component.** Template `5th_anniversary`
   declares `{"type":"HEADER","format":"IMAGE", …}`; Meta requires a matching `header`
   parameter at send time. `sendWhatsAppTemplateMessage` built only `bodyParams` (from
   `{{…}}` scanning) and `buttons`. The `headerParams` plumbing existed end-to-end
   (port → facade → `template-client.ts`'s `header: params.headerParams?.[0]` →
   `buildTemplateSendPayload`) but was **never assigned anywhere** — and its type was
   text-only, so it couldn't have carried an image. With a variable-less BODY the
   payload had zero components against a media-header template → #132012 for **every
   media-header template, every tenant**. Text-header/headerless templates were
   unaffected, which is why it went unnoticed.

2. **All-failed runs were reported as `completed`.** `sendInBatches` tallies member
   failures via `Promise.allSettled` and returned void; `executeCampaign`
   unconditionally set `status: 'completed'` after it. A 100%-failure run looked like a
   success: `completed`, `chargeable_sent_count: 0`, `failure_reason: null`. With
   `WAQ_TRACK_MESSAGES` unset on prod, the worker's stdout log was the only evidence.

Dead-end noted during diagnosis: `campaigns.image_url_en/zh_hk` looked like the header
source, but `applyImageScopeGuard` nulls them for every non-welcome campaign — they are
welcome-flow-only and never reach the template send path. The correct send-time source
is the **template row's own stored header URL**: the submit path deliberately keeps the
URL in `example.header_handle` (a minted `4:` handle expires in ~24h and is
create-time-only; see `resolve-header-media.ts`).

## Solution

1. Widened `TemplateHeaderParam` to a discriminated union (text | image | video |
   document, media carrying `{link}`), matching what the Kapso SDK's
   `headerParamSchema` accepts.
2. `sendWhatsAppTemplateMessage` now finds the media HEADER (`isMediaHeader`) and emits
   `headerParams` with the stored URL via new `readHeaderLink` (domain service, same
   handle-reading rules as the submit path).
3. `sendInBatches` returns its counters (now including `sent`); `executeCampaign` marks
   a `failed > 0 && sent === 0` run as `status: 'failed'` with a fixed tenant-safe
   `failure_reason` instead of `completed`. Deliberately no throw: a throw reverts to
   `active` and burns 3 blind BullMQ retries; the operator revives via PATCH after
   fixing the template.
4. New fail-fast gate `enforceHeaderMedia` (typed `TemplateHeaderMediaMissingError`,
   tenant-meaningful): runs in `executeCampaign` before the active→sending claim, in
   the execute route (→ 409), inside `sendWhatsAppTemplateMessage` (defense in depth
   for the opt-in path), and is allowlisted in the queue's `failure_reason` mapping.

## Prevention

- Test asserting the wire payload: template-client tests now run headerParams through
  the **real** `buildTemplateSendPayload`, so a shape drift fails in CI, not at Meta.
- The all-failed→`failed` contract makes any future systematic send failure visible on
  the dashboard with a reason, instead of a silent `completed`.
- Anti-recurrence memory updated: dead plumbing that types-out an entire feature
  (declared param never assigned) is invisible to both compile and tests unless a test
  asserts the emitted payload — assert at the boundary.
- Related, not fixed here: TEXT-format headers with `{{param}}` fold their params into
  bodyParams (`extractParameters` scans all components); latent, unreported.
