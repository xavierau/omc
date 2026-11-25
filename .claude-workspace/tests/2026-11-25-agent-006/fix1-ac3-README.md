---
id: tests/2026-11-25-agent-006/fix1-ac3-README
type: test
author: dev
created: 2026-11-25
status: active
supersedes: null
superseded_by: null
related: [artifacts/2026-11-25-agent-006-fix1-handoff, artifacts/2026-11-25-agent-006-handoff]
---
# AGENT-006 fix 1, AC-3: is the editedAfterSend flag noise on prod?

Read-only: Supabase Management API `POST /v1/projects/<prod ref>/database/query/read-only`, token read in-process from the macOS keychain item `Supabase CLI`, never printed. Counts only: no member, phone, campaign, template or restaurant identifier is in these files. Run 2026-11-25 04:02Z.

Scripts: `fix1-ac3-q30.py`, `fix1-ac3-q60-90.py`, `fix1-ac3-qstatus.py`. Output: `fix1-ac3-prod-30d.log`, `fix1-ac3-prod-60-90d.log`, `fix1-ac3-prod-status-60d.log`.

## What moves `whatsapp_templates.updated_at`

- Trigger `on_whatsapp_templates_updated` (migration 009): `BEFORE UPDATE ... FOR EACH ROW EXECUTE FUNCTION set_updated_at()`. It fires on **every** UPDATE, with no check on which column changed.
- Every write goes through `whatsapp-template-repository.ts` `update()` / `softDelete()`. The callers are:
  - content edits: `update-whatsapp-template.ts`, including TPL-012's in-place edit of Meta-linked templates;
  - create/submit: `create-whatsapp-template.ts`;
  - resubmit: `wa-templates/resubmit/route.ts`;
  - status only: the status webhook (`template-status-handlers.ts` `applyStatusUpdate`) and the sync cron (`sync-template-status.ts`);
  - soft delete.
- The webhook and the cron skip no-op writes: they write only when the status actually changes. So a status-only change, such as approved → paused → approved, does move `updated_at`. The flag is conservative: that case says "may have changed" when the text did not.

## Numbers (accepted sends = outbound, campaign_id set, status sent | delivered | read)

| window | accepted campaign sends | with template_id | template updated after that send | templates involved |
|---|---:|---:|---:|---:|
| 30 days | 2,139 | 2,139 | **0 (0.0%)** | 1 |
| 60 days | 4,302 | 4,302 | **0** | 2 |
| 90 days | 6,568 | 6,568 | **0** | 4 |

- Templates now: 23 approved (16 updated in the last 30 days), 18 rejected (18 updated in the last 30 days), 1 draft. None of the templates that were updated is one a send in the 90-day window carried after its update.
- Verdict: the flag fires on 0% of the sends today. It is not noise, so no escalation. It fires only when a template that was actually sent is changed later.

## F1 shape on prod

- Campaigns: 46 in total. 9 have no `whatsapp_template_id`: 7 have zh text, 9 have en text, 0 are legacy-only, 0 have no text. Restaurants: all 7 have `default_language` zh_hk. Members' `preferred_language`: zh_hk 3,921, en 40, null 276.
- Campaign sends in 60 days, all statuses: 250 rows with a null `template_id`. **All 250 are `failed` `image` rows**, the coupon QR. No accepted send had a null `template_id` in 90 days, and there are 0 text-type campaign sends. The tool already excludes the failed rows. The F1 inline-text path is correct for the 9 inline campaigns, but no diner has received one of them in the last 90 days.
