---
id: artifacts/2026-11-03-waq-011-detail-r3-handoff
type: handoff
contract: handoff-file-v1
author: dev
created: 2026-11-03
status: active
item: WAQ-011-DETAIL-R3
state: done
brief: inline
base: 21048db4
head: 88d969646000a972bcc7d09b5f94546f6c0f2a83
branch: feature/admin-template-review-detail
pushed: true
stage: poc
suite_changed: true
gate: {result: none, at: none}
next: {owner: main, action: "final re-review of PR https://github.com/xavierau/omc/pull/174 (round 3); merge is the owner's call"}
blockers: []
refs: [artifacts/2026-11-03-waq-011-detail-r2-handoff]
---
ac:
  AC-1: {result: pass, evidence: "RED first: 12 failing (use case: templateId set + template null/throwing → campaigns listed by 'tpl-1'; campaigns: draft/paused with scheduledAt → status label; sections: template null + campaigns [x] → card rendered, [] → empty state; preview model + render: off-list DOCUMENT → external, no <a>). Two other use-case cases went red only because a failing new test leaked its console.warn spy; they went green with the fix. GREEN: npx vitest run src/application/__tests__/get-template-review-detail.test.ts src/components/admin/__tests__ src/infrastructure/supabase/repositories/__tests__ → 72 files / 690 tests."}
  AC-2: {result: pass, evidence: "git diff origin/develop -- src/messages/en.json src/messages/zh-HK.json | grep -c backToReferrers → 0"}
  AC-3: {result: pass, evidence: "python3 ~/.claude/bin/resource-lock.py heavy -- npx tsc --noEmit -p . → exit 0, no output (it waited on the heavy lock held by a payment_management gate run). eslint on the 9 touched src/test files → exit 0."}
  AC-4: {result: pass, evidence: "88d96964 'fix: admin template review detail — campaigns by review template id, draft schedule label, document allowlist (review round 3)' pushed via rtk proxy git push; ls-remote refs/heads/feature/admin-template-review-detail == 88d969646000a972bcc7d09b5f94546f6c0f2a83 == HEAD at push. PR body rewritten with gh pr edit 174 (Known limitations (accepted) section, attribution footer kept); state OPEN, mergedAt null."}
decisions:
  - "R3-1: listBy = review.templateId ?? resolved.template?.id. With an id, campaigns are always listed by it. Without one (id-less review, name lookup found nothing or threw), campaigns are null and campaignsError = the lookup threw. UI condition changed from (template || campaignsError) to (campaigns || campaignsError)."
  - "R3-2 status mapping (Campaign.status = draft|active|sending|paused|completed|failed; there is no 'scheduled'): completed → Sent; failed → Failed; draft/paused → t('campaignStatus.<s>') (草稿 / 已暫停), even with a trigger schedule; active/sending → Automatic if schedule JSON, else 'Scheduled <date>' if scheduledAt, else Manual send."
  - "R3-3: the allowlist check runs before the DOCUMENT branch, so an off-list DOCUMENT URL is kind 'external' (same testid, text only). An allowlisted DOCUMENT URL keeps its link; a non-https handle gives a document label with no href."
suite_changes:
  - "Deliberate, per R3-1/R3-2: the use-case test 'templateId set but no longer resolves' now expects campaigns listed by tpl-1 (it used to expect null). The campaigns tests that asserted Manual send / Scheduled on the default draft fixture now pass an explicit status: active/sending for Scheduled, active for Manual. The card test now expects campaignStatus.draft."
failed: []
invariants:
  - "A review that names a templateId is never shown a different template"
  - "No tenant-controlled off-list URL renders as img/video/a"
unverified:
  - "No browser pass this round (POC stage). The changes are a branch condition and label mapping, and the tests render the components."
  - "Real template_review_queue → panel round trip (DEV lacks the table)"
review_focus:
  - "src/application/get-template-review-detail.ts — listBy and campaignsError semantics"
  - "src/components/admin/template-review-campaigns.tsx — scheduleLabel"
  - "src/components/admin/template-review-preview-model.ts — toHeader order"
scope_drift: []
in_flight: []
next_step: "Main thread: final review of PR #174."
---

Registry: 6 rows (9 testids) were appended to `.claude-workspace/ui-map/testid-registry.md` on the branch. The branch copy matched main before the append. `CLAUDE.md` in the tree is still modified by `next dev` and was not committed. The INDEX / `active/` entry was not written; the brief keeps the INDEX outside files_allowed.
