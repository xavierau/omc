---
id: deploys/2026-08-28-camp-008-release-runbook
type: deploy
author: claude
created: 2026-08-28
status: active
supersedes: null
superseded_by: null
related: [kanban:CAMP-008, kanban:CAMP-004, github:131, github:132, github:133, github:135]
---

# CAMP-008 release runbook — #131 + #132 to production

## What ships
- PR #133 (`fix/camp-004-quick-reply-button`) → develop: #132 QUICK_REPLY authoring.
- PR #135 (`fix/camp-008-issues-131-132`) → develop: #131 v2 status classification, tracking opt-out,
  migration **064** `retract_campaign_sent`, finalize CAS, re-run ledger + coupon reuse.
- develop → main PR (squash-merged PRs land on develop; main takes the merge).
- `scripts/release.sh` from `main` (builds locally, force-pushes the orphan `release` branch; Forge
  deploys it: `npm ci` → `supabase db push --linked --include-all` (applies 064) → seed → restart).

Pre-release facts (verified 2026-08-28):
- Prod runs `main@48dcb1c` (RELEASE.json on the box). Forge site dir `/home/forge/app.ohmyclient.io`.
- Migration 064 validated against a scratch DB built from migrations 001–063 (transaction rolled back).
- `retract_campaign_sent` does NOT exist on prod yet (PostgREST 404 probe) — expected; 064 creates it.

## Blast radius to announce (ops)
1. **Message tracking is now ON by default** (`WAQ_TRACK_MESSAGES` is opt-out). `whatsapp_messages`
   starts filling for every tenant; `reconcile-orphan-messages` Forge job now has rows to sweep;
   KPI dashboards populate.
2. **WAQ-007 per-user marketing cap (default 1 per phone per 24 h, counts sent/delivered/read)
   becomes live for every tenant.** A tenant's second MARKETING campaign to the same phones inside
   24 h will skip them as `cap_exceeded` and the run completes with fewer sends. Raise
   `tenant_campaign_settings.per_user_marketing_cap` per tenant if that bites.
3. `131042` is `log_only` — no Slack post per failed message.

## Post-deploy verification
1. `curl -sf https://app.ohmyclient.io/api/health` → 200; `cat /home/forge/app.ohmyclient.io/RELEASE.json`
   shows the new `source_commit`.
2. Migration: `POST /rest/v1/rpc/retract_campaign_sent` with a zero UUID returns 200 + `[]`
   (function exists, no row matched) — the read script `kushiro-campaigns-read-131.mjs` on the box
   prints this probe.
3. Next Kushiro send (or any tenant's): `logs/webhook-<date>.log` shows `webhook.kind: status` for
   the v2 payloads that used to log `webhook.ignored / parse returned null`, and no
   `status.unknown_message` for the campaign's wamids.
4. Dashboard: a rejected campaign's card shows the Meta-naming `failure_reason` banner.

## Data correction — campaign `7bed8f1b` (釧 Kushiro), the #131 phantom billing
Before (prod, 2026-08-28 read-only snapshot): `status=completed, chargeable_sent_count=2,
non_chargeable_sent_count=0, failure_reason=null`; `whatsapp_messages` empty for it; two active
coupons `MAKL6B` / `YQZJ8P` (not the codes in the issue — the campaign was evidently re-run once
after the issue was written).
`b4ed3737` is already `active / 0 / 0` on prod — nothing to correct.

Correction (post-deploy, uses the shipped RPC so the audit trail is the same as an organic
retraction): `node /home/forge/kushiro-correct-7bed8f1b.mjs` (dry run prints BEFORE only) then
`node /home/forge/kushiro-correct-7bed8f1b.mjs --apply` → two `retract_campaign_sent` calls →
expected AFTER: `status=failed, chargeable_sent_count=0, failure_reason=<131042 wording>`.
Record the printed BEFORE / RETURNING / AFTER lines in this artifact.

Kushiro can re-run the campaign once the WABA currency is set in Meta Business Manager; the
re-run reuses `MAKL6B` / `YQZJ8P` (existing active coupons) and, because no counted ledger rows
exist for the pre-#131 send, counts each member once.

## Rollback
Re-run `scripts/release.sh` from the previous `main` commit (`SOURCE_REF=48dcb1c` after checking it
out) — the release branch is an artifact pointer, not history. Migration 064 only adds a function;
it is safe to leave in place.
