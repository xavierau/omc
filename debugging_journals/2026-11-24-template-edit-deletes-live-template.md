# TPL-012: editing an approved template deleted it on Meta

Date: 2026-11-24. Branch `fix/tpl-012-template-edit-in-place`, PR into develop.

## Problem
Prod, 2026-11-24. A tenant edited the approved template `nov_promo_v3` (zh_HK) in the dashboard.
`updateWhatsAppTemplate` deleted it on Meta and then tried to create it again. Meta refused the
create with code 100, subcode 2388023: a deleted template's name+language stays locked for about
four weeks. The live template was gone, and the active campaign `Nov promo_batch2` now pointed at a
row nothing could send (prod row 8c1f996d).

## Root cause
`src/application/update-whatsapp-template.ts` handled every edit of a Meta-linked row as
delete + create ("Meta requires delete before re-create for templates with the same name"). That
assumption was wrong. Meta has an edit-in-place endpoint, `POST /<TEMPLATE_ID>`, for APPROVED,
REJECTED and PAUSED templates. The delete is irreversible, and the name lock makes the re-create fail
by design. Earlier fixes (the image-header mint and the validation running before the delete) only
narrowed when the delete happened, never whether it should happen. The booking resubmit path
(`booking-template-deps.ts`) reuses the same use case, so booking templates were exposed too.

## Fix
- New port method `WhatsAppTemplatePort.editTemplate(wabaId, metaTemplateId, {components, category?})`
  returns the existing `TemplateSubmitResult`. The Kapso implementation `editMetaTemplate` uses
  `client.request('POST', '/<id>', {query: {businessAccountId}, body, responseType: 'json'})`, with
  the same snake_case encoding as `templates.create`. The SDK has no `templates.edit`.
- Routing: a bare `POST /<id>` gets the Kapso proxy's 404 `WhatsApp configuration not found`. With
  `business_account_id` (or `phone_number_id`) the proxy forwards the call to Graph. Live probe on a
  bogus id, 2026-11-24 (evidence in the handoff).
- In the use case, a linked row is never deleted:
  - These are refused before any Meta call (`TemplateEditRefusedError`, route 400): a name change,
    a language change, a category change on an approved template, and any edit while the row is
    pending review.
  - Edit success: changes persisted, status `pending`, `rejectionReason` null, `metaTemplateId` kept.
  - Edit failure of any kind (the 24h/30-day edit limit, a content rejection, an outage, no key):
    nothing is persisted, and the existing row is returned with Meta's text.
- An unlinked row (draft, or one never accepted by Meta) keeps the create path unchanged.
- Only an `{error: {…}}` Graph body counts as `meta_rejected`. A proxy route error that the SDK also
  wraps in `GraphApiError` maps to a provider error.

## Prevention
- An irreversible external call (delete) must never be step one of an edit. If the provider has an
  in-place operation, use it. If it doesn't, refuse the edit; don't emulate it with delete + create.
- When a code comment states a provider constraint ("Meta requires delete before re-create"), check
  it against the provider docs when the code is touched. This one had no source.
- Tests now assert that `deleteMetaTemplate` is never called on the update path (and the grep
  `deleteMetaTemplate src/application/update-whatsapp-template.ts` is empty). They also assert the
  real wire request of the edit (`template-client-edit.test.ts`, real SDK client, stubbed fetch).

## Not done here
- Prod data repair: the owner recreates the template as `nov_promo_v4`.
- The create path's `createMetaTemplate` still maps proxy route errors to `meta_rejected`. That is
  a pre-existing smell, left alone.
