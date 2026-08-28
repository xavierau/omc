---
id: artifacts/2026-08-28-camp-008-review-round-1-resolution
type: artifact
author: claude
created: 2026-08-28
status: active
supersedes: null
superseded_by: null
related: [kanban:CAMP-008, github:131, github:135, reviews/2026-08-27-camp-008-issue-131-gemini, reviews/2026-08-27-camp-008-issue-131-analyzer]
---

# PR #135 (#131) — review round 1 resolution

Merge verdict, worst-of: gemini **CONDITIONAL** (1 Critical, 1 Important, 1 Minor) · analyzer
**CONDITIONAL** (0 Critical, 3 Important, Minors). The built-in `/code-review 135` lane died on
the account's session limit twice; the two external-lens lanes above are the review of record.

| Source | Finding | Resolution (commit) |
|---|---|---|
| gemini Critical | Migration 064 CTE reads counters under the statement snapshot → concurrent `failed` webhooks lose an update (over-billing) | Retraction computed inline in the UPDATE; verified on a scratch DB built from migrations 001–063 (1775d79). Analyzer lane confirmed the fix. |
| gemini Important | D2 blast radius (WAQ-007 cap goes live; `whatsapp_messages` write volume) | Documented in the PR body and `deploys/2026-08-28-camp-008-release-runbook` ops section; `idx_wa_messages_campaign_status` covers the ledger query. |
| gemini Minor | QR-image failure must never retract | Already pinned by `reconcile-campaign-send-failure.test.ts` and the route integration test. |
| analyzer Important 1 | CAS loss written as a Meta rejection even when no failed body row exists; unscoped write overwrites a tenant's mid-run status change; `completeCampaignRunIfCounted` swallowed `error` | `failCampaignRunIfSending` (scoped to `sending`); neutral wording when `findLatestCampaignFailure` is null; `error` thrown. 3 new tests. |
| analyzer Important 2 | Webhook tenant never compared to the row's tenant (pre-existing WAQ-002 gap, now with billing writes behind it) | `handleStatusUpdate` releases the claim and logs `status.tenant_mismatch` when `message.restaurantId ≠ resolved restaurant`; test added. |
| analyzer Important 3 | `retract_campaign_sent` executable by `authenticated` (045 lock-down precedent) | REVOKE from PUBLIC / anon / authenticated, GRANT to service_role appended to 064. |
| analyzer Minors | layering nit (`CAMPAIGN_BODY_MESSAGE_TYPES` from infra), pre-existing file-size overages, column-level exposure on `campaigns_update` policy | Not applied in the hotfix; the policy exposure is pre-existing and logged as a follow-up. |

Verification after fixes: `vitest run` → 365 files / 3711 tests green; `tsc --noEmit` clean;
`eslint` clean on touched files; migration 064 (with grants) re-validated on the scratch DB.
