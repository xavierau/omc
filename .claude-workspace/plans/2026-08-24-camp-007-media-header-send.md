---
id: plans/2026-08-24-camp-007-media-header-send
status: active
related: [kanban:CAMP-007, github:#127]
author: main-thread (fable) — autonomous /goal run; advisor sanity-check in lieu of solution-architect dispatch
---

# CAMP-007 — Campaign send omits media header component (#127, P1)

## Verified root cause (issue claims checked against code)

1. `sendWhatsAppTemplateMessage` (src/application/send-template-message.ts) builds only
   `bodyParams` + `buttons`. `headerParams` is declared in the port and in
   `template-client.ts:252` (`header: params.headerParams?.[0]`) but **never assigned
   anywhere** — confirmed. A template declaring a media HEADER goes out with zero header
   component → Meta #132012 for every IMAGE/VIDEO/DOCUMENT-header template, all tenants.
2. `TemplateHeaderParam` is text-only, so the plumbing couldn't carry an image anyway.
3. `sendInBatches` tallies failures via `Promise.allSettled` and returns void →
   `executeCampaign` marks `completed` even when 100% of sends failed. Prod row shows
   `completed`, `chargeable_sent_count: 0`, `failure_reason: null`.

**Correction to the issue's suggested fix**: `campaigns.image_url_en/zh_hk` cannot be the
header source for broadcast campaigns — `applyImageScopeGuard`
(patch-helpers.ts:82) nulls both for every non-welcome campaign, and welcome campaigns
never go through `executeCampaign`. The only send-time source is the **template row's own
stored header URL** (`example.header_handle` / `headerHandle` — stored rows deliberately
keep the URL, not the ephemeral `4:` handle; see resolve-header-media.ts docs).

**SDK confirmed ready**: `buildTemplateSendPayload`'s zod `headerParamSchema` accepts
`{type:'image'|'video'|'document', <media>:{id?, link?}}` with `link` validated as URL.
Keys `image`/`link` are single lowercase tokens → safe under the Kapso dual case
converters (see memory `principle_kapso_dual_case_converters`).

## Changes

### A. Media header at send time (primary fix)
- `src/domain/ports/whatsapp-templates.ts`: widen `TemplateHeaderParam` to a
  discriminated union: text (unchanged) | `{type:'image', image:{link}}` | video |
  document. Link-only (no `id`) — a stored `4:` upload handle is not a send-time media
  id, so there is nothing else we could legally pass (YAGNI).
- `src/domain/services/template-media-header.ts`: add `readHeaderLink(c)` — first
  handle entry when it is an http(s) URL, else null. Lives here so send path and
  submit path read handles by the same rules.
- `src/application/send-template-message.ts`: find the media HEADER via existing
  `isMediaHeader`; build `headerParams: [{type: image|video|document, <kind>: {link}}]`
  from `readHeaderLink`. Calls the guard (C) first, so an unresolvable media header
  throws a typed error instead of sending a payload Meta will reject.
- `src/infrastructure/kapso/template-client.ts`: replace the inline text-only
  `headerParams` type with the port's `TemplateHeaderParam[]`. Pass-through logic
  unchanged (`header: params.headerParams?.[0]`).

### B. All-failed runs must not read `completed`
- `execute-campaign-batch-counters.ts`: add `sent` to `SkipCounters`; `tally` counts
  fulfilled `'sent'` outcomes.
- `sendInBatches` returns the counters.
- `execute-campaign.ts`: after the batch, `failed > 0 && sent === 0` → 
  `updateCampaign(id, {status:'failed', failureReason: <fixed tenant-safe message with count>})`
  and return; else `completed` as today. Partial failures stay `completed` (issue scope).
  Terminal-with-reason rather than throw: a throw would revert to `active` and burn 3
  blind BullMQ retries against a deterministic mismatch; operator can revive via PATCH
  (revival guard already clears the reason).

### C. Fail-fast guard (issue suggestion 4)
- New `src/application/enforce-header-media.ts`: `TemplateHeaderMediaMissingError`
  (tenant-meaningful) + `enforceHeaderMedia(template | null)` — throws when the template
  declares a media header and `readHeaderLink` yields nothing.
- Wire in the same order in BOTH gate sites (their comments mandate no drift):
  `executeCampaign` (before the active→sending claim → status untouched on failure) and
  `POST /campaigns/[id]/execute` route (map to 409, like NotApproved).
- `campaign-queue.ts`: add the error to `isTenantMeaningfulError` so retry exhaustion
  writes the real reason to `failure_reason`.

## Test plan (TDD — write first)
- send-template-message: image/video/document header + snake & camel handle keys →
  correct headerParams; `4:` handle → typed throw; TEXT header / no header → undefined.
- enforce-header-media: null template, no header, text header, media+URL pass;
  media+handle, media+empty throw.
- execute-campaign: all-sends-fail → `failed` + `failureReason`, never `completed`;
  partial fail → `completed`; media-header-no-URL template → throws before
  `transitionCampaignStatus`.
- execute route: 409 + message for the new error.
- template-client: headerParams flow through the real `buildTemplateSendPayload` into a
  `header` component (validates our shape against the SDK zod schema).
- campaign-queue: new error class → verbatim failure reason.

## Out of scope (mention-only)
- TEXT-format headers with `{{param}}`: `extractParameters` folds header params into
  bodyParams — latent, unreported, untouched.
- Stuck campaign "testing broadcast" retry-looping WAQ-011 on prod — separate issue per #127.
- `WAQ_TRACK_MESSAGES` unset on prod (no whatsapp_messages evidence) — ops decision.

## Release
PR → develop → /review → merge → develop→main PR → deploy to Forge prod per existing
deploy runbook (deploys/ artifacts), verify worker restart + re-run the failed campaign
with operator.
