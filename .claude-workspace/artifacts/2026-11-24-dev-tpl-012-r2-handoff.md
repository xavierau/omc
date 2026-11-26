---
id: artifacts/2026-11-24-dev-tpl-012-r2-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-24
status: active
item: TPL-012
state: done
brief: inline (TPL-012 r2)
base: f50d41057cf024d42645793157b7848b3cf819a1
head: afe1a4169fc751aaad933bf26f35c7901a8a72cb
branch: fix/tpl-012-template-edit-in-place
pushed: true
stage: poc
suite_changed: true
gate: {result: none, at: none}
next: {owner: main, action: "re-review PR #227 f50d410..afe1a41"}
blockers: []
refs: [kanban:TPL-012, github:#227, artifacts/2026-11-24-dev-tpl-012-handoff, tests/evidence/2026-11-24-tpl-012-r2/, debugging_journals/2026-11-24-template-edit-deletes-live-template.md]
---
# TPL-012 r2 handoff: review round 1 fixes on PR #227

Stage POC (no mature import, no WT_STAGE). Code commit afe1a416; this file and the log row are in a later docs commit on the same branch. PR comment: https://github.com/xavierau/omc/pull/227#issuecomment-7127869741

ac:
  AC-1: {result: pass, evidence: "update-whatsapp-template.test.ts 'a no-op edit of a linked row touches nothing': identical full form (structuredClone), full-width-brace normalized text, header-image URL row → editMetaTemplate/updateTemplate/uploadHeaderMediaFromUrl 0 calls, status stays approved; one-char body change edits. Red: tests/evidence/2026-11-24-tpl-012-r2/red.log (3 no-op cases red at base)"}
  AC-2: {result: pass, evidence: "'status gate for in-place edits': disabled → TemplateEditRefusedError /disabled.*create a new template/, 0 Meta calls; paused, rejected → editMetaTemplate once. Red at base: red.log"}
  AC-3: {result: pass, evidence: "'Meta accepted the edit but the row could not be saved': no throw, existing row, errorCode meta_edited_not_saved, console.error carries live-meta-id, rest-1, tpl-1; route.test.ts 500 with {template, error}. Both red at base: red.log"}
  AC-4: {result: pass, evidence: "template-client-edit.test.ts: 429 {error:{message:'Rate limit exceeded'}} → template_create_error (red at base); {error:{code:100,…}} → meta_rejected"}
  AC-5: {result: pass, evidence: "tests/evidence/2026-11-24-tpl-012-r2/tsc.log; resource-lock heavy npx tsc --noEmit exit 0; the only heavy command this round"}
  AC-6: {result: pass, evidence: "rtk proxy git push; ls-remote afe1a416 == HEAD; journal '## Review round 1 (PR #227, r2)'; PR comment issuecomment-7127869741"}

decisions:
  - "No-op check runs AFTER assertEditableInPlace: a status/name/language refusal stays a refusal even when the content is unchanged (an unchanged save of a pending or disabled row still answers 400). It runs BEFORE the WABA lookup and header minting, so a no-op makes zero Meta calls, including no media upload."
  - "Deep equality: node:util isDeepStrictEqual (the repo has no helper or deep-equal dependency). It ignores key order, so it is safe against jsonb reordering. It is strict on {k: undefined} vs a missing k, but both sides are JSON (request body, jsonb), so neither has undefined keys."
  - "No-op compares changes.components ?? existing.components and changes.category ?? existing.category, so a PATCH that omits components or category counts as unchanged on that field."
  - "F3: errorCode 'meta_edited_not_saved' → route 500 (our write failed, not the provider's: 502 stays for provider errors). Message: WhatsApp already has the new content under review, the app did not save it, do not edit again, contact support. Log tag '[TPL-012] Meta edit applied but the row was not saved; reconcile by hand' with restaurantId, templateId, metaTemplateId, error message."
  - "Route status mapping moved into a small patchErrorStatus helper (meta_rejected 422, meta_edited_not_saved 500, else 502)."
failed: []
invariants:
  - "update-whatsapp-template.ts never calls deleteMetaTemplate"
  - "a failed in-place edit makes zero updateTemplate calls and returns the existing row"
  - "unlinked rows keep the create path unchanged (no-op check is linked-only)"
  - "a no-op edit of a linked row makes zero Meta calls (edit, create, delete, media upload) and zero writes"
unverified:
  - "That the dashboard form round-trips stored components exactly: buildWaTemplateRequestBody was not run against a real stored row. If the form adds or drops a field, an unchanged save is not detected as a no-op and still edits (the r1 behaviour, not a regression). Owner: main, a browser check or a unit test of buildWaTemplateRequestBody against a stored row."
  - "Full vitest suite not run this round (POC, brief ACs name the touched files and tsc only)."
review_focus:
  - "src/application/update-whatsapp-template.ts isNoOpEdit placement (after refusals, before WABA lookup) and the pending/disabled no-op ordering"
  - "src/application/update-whatsapp-template.ts editOnMeta try/catch: only updateTemplate is inside it; editMetaTemplate failures still take describeEditFailure"
  - "src/infrastructure/kapso/template-client.ts isGraphErrorEnvelope numeric-code check"
scope_drift:
  - "Two r1 tests ('a transient provider failure…', 'no Kapso key…') sent components: [] to a row with components [], which F1 turns into a no-op. Their input now carries a real body change; assertions unchanged. That is the suite_changed: true above."
  - "createMetaTemplate (create path) still maps any GraphApiError to meta_rejected without the envelope check: pre-existing, not touched (outside F4's scope)."
  - "kanban.json not updated: .claude/ is outside files_allowed; TPL-012 stays in review."
next_step: "Re-review PR #227 on f50d410..afe1a41, then merge into develop."
