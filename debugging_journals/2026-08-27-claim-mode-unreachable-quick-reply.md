# 2026-08-27 — Claim-mode campaigns unreachable: the template form cannot author a QUICK_REPLY button (#132)

## Problem

CAMP-001 shipped the full claim-on-tap broadcast flow (send template with a `CLAIM_<campaignId>`
quick-reply payload → customer taps → coupon minted + QR sent inside the open 24-hour window).
In production no campaign ever used it: every one of Kushiro's three approved templates fell to
the legacy eager path, whose free-form coupon-QR image needs an open service window and so failed
with Meta `131047` for every recipient who had not messaged the business in the last 24 hours
(observed on campaigns `7bed8f1b` and `b4ed3737`, see #131).

## Root cause

Broadcast mode is *inferred* from template shape — `isClaimTemplate` returns true only when the
template has a `QUICK_REPLY` button. The dashboard template form's button union was
`'URL' | 'PHONE_NUMBER' | 'COUPON_URL'` and its `<select>` offered only those three, so no tenant
could ever produce the shape that selects claim mode. Authoring the template directly in Meta
Business Manager was not a workaround either: `sync-template-status` only pushes *status* onto
rows that already exist locally and never imports components.

A second, latent defect in the same file: `parseButtons` cast whatever stored `type` it found to
the form union, so a template carrying a `QUICK_REPLY` or `COPY_CODE` button loaded into the
form produced a select with no matching option and was silently rewritten on save.

## Solution (PR #133, branch `fix/camp-004-quick-reply-button`)

- `QUICK_REPLY` added to the form's `TemplateButton['type']` union and the type select (label
  only; no URL/phone field). Its hint states that adding one switches every campaign using the
  template into claim mode.
- `parseButtons` no longer casts: `URL` / `PHONE_NUMBER` / `QUICK_REPLY` (and the app's own
  `COUPON_URL` detection) map to their form variants; anything else (`COPY_CODE`, unknown) becomes
  a typed `UNSUPPORTED` row that renders read-only and is re-emitted byte-for-byte on save.
- Client validation refuses the two combinations claim mode cannot satisfy: a `QUICK_REPLY`
  alongside a `COUPON_URL` (the claim send has no coupon code for the `{{1}}` URL parameter), and
  quick-reply buttons interleaved with call-to-action buttons (Meta requires each group to be
  contiguous; on the edit path the live template is deleted before Meta refuses the new one).
- Domain (`TemplateButtonType`), validation (`validateButtons` is type-gated), Meta submit
  (`prepareButtons` passes through), send (`buildQuickReplyButtonParams`) and claim paths already
  handled `QUICK_REPLY` — untouched.

## Prevention

- **Inference is the real defect.** CAMP-004 (explicit per-campaign claim flag, validated against
  the template at save time) stays open as the proper fix; an operator who omits or adds a
  quick-reply button today still silently changes the customer journey.
- A feature that only works for a shape the product cannot produce is not shipped. When a mode is
  selected by data shape, the authoring UI for that shape is part of the feature's Integration
  Map — check the entry point, not just the send path.
- Never cast a stored discriminator to a UI union. Map the known values explicitly and give
  unknown ones a typed, read-only representation that round-trips unchanged.
