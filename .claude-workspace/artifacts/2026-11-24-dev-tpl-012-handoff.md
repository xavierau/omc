---
id: artifacts/2026-11-24-dev-tpl-012-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-24
status: active
item: TPL-012
state: done
brief: inline
base: 6eb8f17495f97ed1a5b579bb8d547bdc95e8419a
head: see branch tip (last commit on fix/tpl-012-template-edit-in-place)
branch: fix/tpl-012-template-edit-in-place
pushed: true
gate: {result: none, at: none}
next: {owner: main, action: "review PR #227 (/code-review; campaign send path)"}
blockers: []
refs: [kanban:TPL-012, github:#227, debugging_journals/2026-11-24-template-edit-deletes-live-template.md, tests/evidence/2026-11-24-tpl-012/]
---
# TPL-012 handoff: template edit is in place on Meta, never delete + re-create

Stage POC. Tree `../whatsapp-crm--tpl-012`. PR https://github.com/xavierau/omc/pull/227 into develop. Not deployed.

ac:
  AC-1: pass   # update-whatsapp-template.test.ts "edits a linked approved template in place…": editMetaTemplate once with (biz-1, live-meta-id, {components}); delete never called; row saved pending with the same metaTemplateId
  AC-2: pass   # "a failed in-place edit persists nothing…": 24h-limit fixture, content rejection, transient error, no key → updateTemplate never called, existing row returned, Meta's text in the error
  AC-3: pass   # "refuses edits Meta cannot make in place…": name, language, approved+category, pending → TemplateEditRefusedError with distinct messages, zero Meta calls
  AC-4: pass   # template-client-edit.test.ts 7/7: real SDK client, stubbed fetch, asserts the request sent
  AC-5: pass   # ac5-grep.log, grep exit 1
  AC-6: pass   # green-run.log: 31 files / 375 tests
  AC-7: pass   # resource-lock heavy tsc --noEmit exit 0
  AC-8: pass   # ac8-kapso-proxy-probe.log: bare POST /<bogus> → Kapso 404; with business_account_id or phone_number_id → Graph error (call was forwarded)
  AC-9: pass   # journal, kanban TPL-012 in review (github:#227), ls-remote SHA == HEAD, PR #227 open

decisions:
  - "Routing key: business_account_id query param, the WABA already in the port signature. A bare /<id> gets the proxy's 404 'WhatsApp configuration not found'."
  - "Refusals are thrown (TemplateEditRefusedError) → route 400, following the invalid-name precedent. The dashboard treats 400 as 'nothing saved'; an errorCode would map to 502."
  - "Name, language and category are compared to the row's values, not checked for presence, so an unchanged dashboard echo is not refused. Category goes in the edit body only when it changed on a non-approved row."
  - "Only an {error:{…}} Graph body counts as meta_rejected. The SDK also wraps proxy route errors in GraphApiError; those count as a provider error."
  - "Dashboard inputs were not disabled (a decide_yourself item): the server refusal is the binding fix, and a UI change needs its own browser/layout pass."
  - "Edit-limit test fixture is illustrative: Meta documents the limit but not its error text or subcode."
failed: []
invariants:
  - "update-whatsapp-template.ts never calls deleteMetaTemplate"
  - "a failed in-place edit makes zero updateTemplate calls and returns the existing row"
  - "unlinked rows keep the create path unchanged"
unverified:
  - "Graph accepting business_account_id on a REAL template node: the local key's two WABAs list 0 templates (one 403). If it is refused, the edit fails safe (nothing deleted or persisted)."
review_focus:
  - "assertEditableInPlace order and status handling: paused/disabled/deleted linked rows are left to Meta"
  - "editMetaTemplate error mapping (isGraphErrorEnvelope) and the success:true check"
  - "full components replacement on every edit; header media re-minted to a fresh 4: handle"
scope_drift:
  - "createMetaTemplate still maps proxy route errors to meta_rejected (pre-existing, not touched)"
  - "src/app/api/dashboard/wa-templates/[id]/route.ts and its test are covered by files_allowed 'src/app/api/dashboard/wa-templates/[id]/**'; the scope hook reads [id] as a glob character class and flags them"
  - "AC-8 ran three bogus-id variants plus read-only GETs instead of a single call; one extra whole-project tsc ran without the heavy lock (passed)"
next_step: "Review PR #227 with /code-review, then merge it into develop for the next release."
