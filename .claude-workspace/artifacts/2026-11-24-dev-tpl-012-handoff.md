---
id: artifacts/2026-11-24-dev-tpl-012-handoff
type: artifact
author: dev
created: 2026-11-24
status: active
supersedes: null
superseded_by: null
related: [kanban:TPL-012]
---
# TPL-012 handoff: template edit edits in place on Meta, never deletes

Stage: **POC** (no `stages/mature.md` import, no WT_STAGE). Tree `../whatsapp-crm--tpl-012`, branch
`fix/tpl-012-template-edit-in-place` from base 6eb8f174 (origin/develop). Journal:
`debugging_journals/2026-11-24-template-edit-deletes-live-template.md`.

## What changed
| file | purpose |
|---|---|
| `src/application/update-whatsapp-template.ts` | A linked row goes through `editOnMeta` (POST /<id>) instead of delete + create. `assertEditableInPlace` refuses name/language changes, a category change on an approved row, and any edit while pending, before any Meta call (`TemplateEditRefusedError`). A failed edit persists nothing. The `deleteMetaTemplate` import is removed. |
| `src/domain/ports/whatsapp-templates.ts` | New `editTemplate(wabaId, metaTemplateId, {components, category?}): Promise<TemplateSubmitResult>` |
| `src/infrastructure/kapso/template-client.ts` | `editMetaTemplate`: `client.request('POST', '/<id>', {query: {businessAccountId}, body, responseType: 'json'})`; Graph envelope → `meta_rejected`, proxy route error / network / non-`success` → `template_create_error`, no key → `kapso_no_api_key` |
| `src/infrastructure/whatsapp/templates.ts`, `.../kapso/template-adapter.ts` | wiring of the new port method |
| `src/app/api/dashboard/wa-templates/[id]/route.ts` | `TemplateEditRefusedError` → 400 with the message, no `console.error` (the dashboard treats 400 as "nothing saved") |
| tests | use-case suite rewritten to the edit contract; new `src/infrastructure/kapso/__tests__/template-client-edit.test.ts` (real SDK client, stubbed fetch, asserts the wire); adapter and route cases |

## Key decisions
- **Routing key = `business_account_id` query param.** The probe showed that a bare `POST /<id>` gets
  Kapso's 404 `WhatsApp configuration not found`, while `?business_account_id=` and `?phone_number_id=`
  are both forwarded to Graph. The brief's port signature already carries the WABA, so that is the key
  used. That Graph accepts the extra param on a REAL template was not provable here: the local key's
  two WABAs list 0 templates (one 403), so no read-only GET on a real template node was possible.
- **Refusals are thrown, not returned.** They follow the invalid-name precedent: the route gives 400
  and the dashboard shows the message with nothing saved. An `errorCode` would have mapped to 502.
- **Category is sent only when it changed** (and the row is not approved). Unchanged form fields
  (name/language/category echoed back by the dashboard) are compared against the row, not their
  presence, so a normal dashboard save of an approved template is not refused.
- **A proxy route error is a provider error, not `meta_rejected`.** The SDK wraps
  `{"error":"<string>"}` in `GraphApiError` too; only an `{error:{…}}` body is Meta's verdict.
  `createMetaTemplate` still has that smell (it maps every GraphApiError to `meta_rejected`); not
  touched.
- **Dashboard inputs not disabled** (a decide_yourself item, skipped). The server refusal is the
  binding fix, and a UI change would need its own browser/layout pass.
- **Edit-limit fixture is illustrative.** Meta documents the limit (1/24h, 10/30d for APPROVED) but
  not its error text or subcode; the test string follows `describeGraphError`'s shape.

## Acceptance
| id | result | evidence |
|---|---|---|
| AC-1 | pass | `update-whatsapp-template.test.ts` "edits a linked approved template in place…" |
| AC-2 | pass | "a failed in-place edit persists nothing…" (24h limit, content rejection, transient, no key) |
| AC-3 | pass | "refuses edits Meta cannot make in place…" (4 cases + distinct-message check) |
| AC-4 | pass | `npx vitest run src/infrastructure/kapso`: `template-client-edit.test.ts` 7 cases |
| AC-5 | pass | `tests/evidence/2026-11-24-tpl-012/ac5-grep.log` (no matches) |
| AC-6 | pass | 31 files / 375 tests green (`green-run.log`); delete-then-recreate tests converted, the old transient-linked case folded into the new linked + unlinked cases |
| AC-7 | pass | `resource-lock.py heavy -- npx tsc --noEmit` exit 0 |
| AC-8 | pass (proxy forwards) | `tests/evidence/2026-11-24-tpl-012/ac8-kapso-proxy-probe.log`, script `ac8-probe.mjs`; no key printed |
| AC-9 | see PR | journal + kanban TPL-012 (review) + PR into develop |

RED before the fix: `tests/evidence/2026-11-24-tpl-012/red-run.log` (impl stashed: 26 failed / 41 passed
across the touched suites).

## Review hand-off
- An edit sends the full components array (Meta replaces components wholesale). Header media is
  re-minted to a fresh `4:` handle on every edit, as the create path does.
- A linked row in status `paused`/`disabled`/`deleted` is not refused up front. Meta decides, and on
  failure nothing is persisted.
- The edit path writes no `rejectionReason` on failure. The row keeps its current state, which matches
  the template that is still live.

## Next
`next`: main thread dispatches review of the PR (money-adjacent campaign send path → `/code-review`).
No deploy in this item.
