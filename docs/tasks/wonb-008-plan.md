# WONB-008 — Re-confirmation campaign (Strategy B backend)

**Branch:** `feature/wonb-008` · **Migration slot:** `050_campaign_mode_reconfirmation.sql`
**Playbook ref:** `docs/playbooks/staff-number-onboarding-and-marketing.md` §6.2 Strategy B
**Estimate:** 3d · **Depends on:** WONB-005 ✅, WONB-007 ✅ (both merged on develop)

## Goal
New campaign mode `reconfirmation` that targets legacy members (migration 038 backfill: `grade='weak' AND status='opted_in'`) — flagged as marketable in the system but with no provable WhatsApp consent. Sends a forced utility template asking them to reply YES to upgrade their grade to `strong`. Hard-paced at 50/day per tenant (configurable up to 100 by platform admin). Auto-pause on YELLOW quality drop with platform-admin-only resume.

## Locked decisions (user-approved)
| # | Decision |
|---|---|
| Q-H | "Green for ≥7 consecutive days" — strict semantics: any non-Green event within last 7d disqualifies. Encoded in DB function `tenant_green_for_days`. |
| Q-H2 | Mid-campaign quality drop to YELLOW → auto-pause + platform-admin-only resume. Tenant-manager can NOT manually resume reconfirmation campaigns. |
| Q-I | 50/day cap is **per-tenant** (sums across all reconfirmation campaigns), configurable in [50, 100] by platform admin via `tenant_campaign_settings.reconfirmation_daily_cap`. Default 50. Tenant cannot edit. |
| Q-J | Tenant-manager can create the campaign; platform-admin overrides on auto-pause resume. |
| Q-O | Cap is constant per-tenant; NOT multiplied by `auto_throttle_factor`. |
| **Q-P** | **Audience = `grade='weak' AND status='opted_in'`** — migration 038 backfill rows (legacy paper-list / pre-system contacts). YES upgrades grade weak→strong (status stays opted_in). NO revokes (status→opted_out). |

## Why Option B (the user's choice)

The migration 038 backfill flagged pre-system members as `consent_grade='weak', status='opted_in'` — operationally marketable but no provable WhatsApp consent. WONB-008 is the path to graduate them to `strong` via a one-time WhatsApp utility template confirmation. WONB-007's `confirmMarketingOptin` won't work directly — it flips status pending→opted_in, but here we need a grade upgrade weak→strong on a row already opted_in. New repo method + new YES handler.

## Acceptance criteria

1. New campaign mode `reconfirmation` selectable via "Re-confirm legacy contacts" button on Campaigns page.
2. Pre-flight blocks launch unless ALL of:
   a. Tenant `quality_rating='GREEN'` for ≥7 consecutive days (via `tenant_green_for_days(restaurantId, 7)` RPC).
   b. Audience filter: at least 1 `consent_records` row WHERE `grade='weak' AND status='opted_in' AND category='marketing'`.
   c. Today's tenant-wide reconfirmation send count < `reconfirmation_daily_cap` (default 50, max 100, platform-admin only).
   d. Tenant `auto_pause_active=false` (existing guardrail).
3. Pacing: per-tenant cap (sum across all reconfirmation campaigns) enforced in `check-campaign-guardrails`.
4. Template forced to UTILITY category (validated like WONB-007 does for opt-in).
5. On YES reply → existing `weak+opted_in` row upgraded to `strong+opted_in` via new repo method `upgradeGradeToStrong`. `granted_at=now()` stamped.
6. On NO reply → revoked (existing path).
7. No reply → row stays as-is (still grade='weak', status='opted_in'). Customer remains marketable but not strongly graded. Future campaigns can re-target.
8. Mid-campaign quality drop to YELLOW → auto-pause via existing WAQ-009 path; reconfirmation resume requires platform admin.
9. Tenant-manager creates the campaign; gates enforced at create AND execute time.
10. No message ever sent to a `grade != 'weak'` OR `status != 'opted_in'` contact through this mode (defence-in-depth: query-level filter + per-row check at send time).
11. Audit `events.type='campaign'` row on launch with `data_json={ mode: 'reconfirmation', audienceCount }`.
12. YES upgrade emits `events.consent_granted` with `data_json={ source: 'reconfirmation_campaign', previousGrade: 'weak' }`.

## Database — `050_campaign_mode_reconfirmation.sql`

```sql
-- WONB-008: re-confirmation campaign mode (Strategy B).
--
-- 1. Adds campaigns.mode column (separate from campaigns.type which is
--    consumed by audience resolution and welcome-mapping logic).
-- 2. Adds tenant_campaign_settings.reconfirmation_daily_cap (50–100, default 50,
--    platform-admin only; tenant cannot edit).
-- 3. Adds RPC tenant_green_for_days for the GREEN-for-N-days pre-flight check.

-- 1. Campaign mode column
ALTER TABLE campaigns
  ADD COLUMN mode TEXT NOT NULL DEFAULT 'marketing'
    CHECK (mode IN ('marketing', 'reconfirmation'));

COMMENT ON COLUMN campaigns.mode IS
  'marketing (default): regular campaign with full audience eligibility. reconfirmation: WONB-008 Strategy B — weak+opted_in audience, configurable per-tenant 50–100/day cap, GREEN-7d pre-flight, YES upgrades weak→strong.';

CREATE INDEX idx_campaigns_mode_restaurant
  ON campaigns(restaurant_id, mode)
  WHERE mode = 'reconfirmation';

-- 2. Per-tenant cap
ALTER TABLE tenant_campaign_settings
  ADD COLUMN reconfirmation_daily_cap INTEGER NOT NULL DEFAULT 50
    CHECK (reconfirmation_daily_cap BETWEEN 50 AND 100);

COMMENT ON COLUMN tenant_campaign_settings.reconfirmation_daily_cap IS
  'WONB-008: max reconfirmation sends per day per tenant. Sum across all reconfirmation campaigns. Platform admin can adjust (default 50, max 100); tenant cannot edit. NOT multiplied by auto_throttle_factor.';

-- 3. GREEN-for-N-days RPC (Q-H strict semantics)
DROP TRIGGER IF EXISTS tos_advance_immutability ON tenant_onboarding_state;  -- noop guard for re-runs
CREATE OR REPLACE FUNCTION tenant_green_for_days(
  p_restaurant_id UUID,
  p_min_days INTEGER
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH latest_non_green AS (
    SELECT MAX(transitioned_at) AS at
    FROM tenant_quality_state
    WHERE restaurant_id = p_restaurant_id
      AND quality_rating != 'GREEN'
  ),
  earliest_green AS (
    SELECT MIN(transitioned_at) AS at
    FROM tenant_quality_state
    WHERE restaurant_id = p_restaurant_id
      AND quality_rating = 'GREEN'
  ),
  current_state AS (
    SELECT quality_rating
    FROM tenant_quality_state
    WHERE restaurant_id = p_restaurant_id
    ORDER BY transitioned_at DESC, created_at DESC
    LIMIT 1
  )
  SELECT
    EXISTS (SELECT 1 FROM current_state WHERE quality_rating = 'GREEN')
    AND (
      (
        (SELECT at FROM latest_non_green) IS NULL
        AND (SELECT at FROM earliest_green) IS NOT NULL
        AND (SELECT at FROM earliest_green) <= now() - (p_min_days || ' days')::interval
      )
      OR (
        (SELECT at FROM latest_non_green) IS NOT NULL
        AND (SELECT at FROM latest_non_green) <= now() - (p_min_days || ' days')::interval
      )
    )
$$;

REVOKE EXECUTE ON FUNCTION public.tenant_green_for_days(UUID, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tenant_green_for_days(UUID, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_green_for_days(UUID, INTEGER) TO service_role;
```

## Layers & file plan

### Domain
- `src/domain/services/is-green-for-at-least.ts` — pure function mirroring the SQL semantics for unit tests (no IO). Walks `QualityStateEvent[]` history, returns boolean. Test exhaustively: no events, only GREEN, GREEN→YELLOW→GREEN within 7d, GREEN→YELLOW→GREEN gap >7d, current=YELLOW.

### Application
- `src/application/check-reconfirmation-eligibility.ts` — composes existing `checkCampaignGuardrails` (auto-pause + monthly limits) with: (a) `qualityStateRepository.isGreenForDays(restaurantId, 7)` RPC call; (b) `consentRecordRepository.countByGradeStatus({ grade: 'weak', status: 'opted_in', category: 'marketing' })`; (c) per-tenant reconfirmation 24h send count vs `reconfirmation_daily_cap`. Returns `{ allowed, violations, audienceCount, currentDailySent, cap }`.
- `src/application/resolve-reconfirmation-audience.ts` — queries members joined with consent_records WHERE `grade='weak' AND status='opted_in' AND category='marketing'`, sorted by `captured_at DESC`, limited to remaining daily allotment (`cap - currentDailySent`).
- `src/application/execute-reconfirmation-batch.ts` — wraps existing `execute-campaign-batch.ts`. Forces utility template. Per-row defence-in-depth re-check: row must still be `grade='weak' AND status='opted_in'` at send time (catches concurrent updates).
- `src/application/confirm-reconfirmation-consent.ts` — NEW. Called from the YES handler. Calls `consentRecordRepository.upgradeGradeToStrong({ restaurantId, phoneE164, category })`. Emits `consent_granted` event with `data_json={ source: 'reconfirmation_campaign', previousGrade: 'weak' }`. Returns `{ upgraded: boolean }`.

### Infrastructure
- `src/infrastructure/supabase/repositories/consent-record-repository.ts` — add 2 methods:
  - `countByGradeStatus(args: { restaurantId, grade, status, category })` — returns count
  - `upgradeGradeToStrong(args: { restaurantId, phoneE164, category })` — UPDATE: `WHERE restaurantId=$1 AND phone_e164=$2 AND category=$3 AND consent_grade='weak' AND status='opted_in'` SET `consent_grade='strong', granted_at=now()`. Returns boolean (true if affected_rows > 0). Idempotent.
- `src/infrastructure/supabase/repositories/quality-state-repository.ts` — add `isGreenForDays(restaurantId, minDays)` RPC wrapper.
- `src/infrastructure/supabase/repositories/campaign-mapper.ts` — round-trip `mode` column.
- `src/infrastructure/supabase/repositories/tenant-campaign-settings-repository.ts` (or wherever tenant_campaign_settings lives) — read `reconfirmation_daily_cap`. Add admin-only update method.

### Domain entity changes
- `src/domain/entities/campaign.ts` — add `mode: 'marketing' | 'reconfirmation'` prop. Default 'marketing' for backward compat.

### API routes
- `POST /api/dashboard/campaigns/reconfirmation/preflight` — tenant-manager. Returns `{ allowed, violations, audienceCount, currentDailySent, cap }`. Used by dialog UI.
- Modify `POST /api/dashboard/campaigns` — accept `mode: 'reconfirmation'`. Re-run preflight server-side (don't trust client). Force utility template, force mode='reconfirmation'. Reject with 400 if pre-flight fails.
- `POST /api/admin/tenants/[id]/campaigns/[campaignId]/reconfirmation/resume` — platform-admin only. Re-checks GREEN-7d. Resumes auto-paused reconfirmation campaign.
- `PATCH /api/admin/tenants/[id]/campaign-settings` — platform-admin only. Update `reconfirmation_daily_cap` (50–100). Existing tenant-settings route may already exist; extend it.

### Webhook integration — extend `dispatchConfirmation`
WONB-007 already extended `dispatchConfirmation` for opt-in YES/NO. Add a third try for reconfirmation:
```typescript
async function dispatchConfirmation(ctx, route: 'YES' | 'NO' | null) {
  // 1. Receipt confirmation (existing) — wins YES.
  // 2. WONB-007 opt-in confirmation (pending → opted_in).
  // 3. NEW WONB-008 reconfirmation (weak → strong on opted_in).
  if (route === 'YES') {
    if (await handleReceiptConfirmation(...)) return
    if (await handleOptinConfirmation(ctx)) return  // WONB-007
    if (await handleReconfirmationConsent(ctx)) return  // NEW WONB-008
  } else if (route === 'NO') {
    if (await handleOptinRejection(ctx)) return  // WONB-007 (also handles reconfirmation NO via revoke)
  }
  return handleUnknown(...)
}
```

`handleReconfirmationConsent` — new, in `src/app/api/webhooks/whatsapp/reconfirmation-consent.ts`:
- Calls `confirmReconfirmationConsent({ restaurantId, phoneE164 })`.
- Returns `true` only if a weak+opted_in row was upgraded.
- Sends free-text reply if window open ("Confirmed — thanks for verifying.").

NO handling: WONB-007's `handleOptinRejection` already revokes any pending or opted_in row in marketing category. For reconfirmation NO, we want to revoke the existing weak+opted_in row → status='opted_out'. Verify WONB-007's revoke covers this; if not, extend.

### UI
- `src/components/dashboard/reconfirmation-campaign-dialog.tsx` — pre-flight on open; show breakdown of violations; if allowed, show audience count + sample 5 phones + template preview.
- `src/components/dashboard/reconfirmation-status-badge.tsx` — shown on each campaign card if `mode='reconfirmation'`.
- `src/hooks/use-reconfirmation-preflight.ts` — SWR hook against `/preflight`.
- Modify `src/app/dashboard/campaigns/page.tsx` — add "Re-confirm legacy contacts" button next to "Create campaign". Opens the dialog.

### i18n (en + zh-HK)
Namespace `reconfirmation.*`:
- `buttonLabel`: "Re-confirm legacy contacts"
- `dialogTitle`: "Re-confirm legacy contacts"
- `explainer`: "Send a one-time utility template to legacy contacts whose marketing consent was inherited from older systems but never confirmed via WhatsApp. They reply YES to upgrade their consent to strong. Paced at {cap}/day for safety."
- `preflightOk`: "Ready to launch — {n} contacts eligible."
- `preflightFailQualityNotGreen`: "Tenant quality must be GREEN for 7 consecutive days. Current: {state}, since {since}."
- `preflightFailEmptyAudience`: "No legacy contacts to re-confirm. (Audience: weak-graded but opted-in members from pre-system migration.)"
- `preflightFailDailyCapMet`: "Today's reconfirmation cap reached ({sent}/{cap}). Continue tomorrow."
- `preflightFailQualityPaused`: "Reconfirmation paused due to quality drop. Awaiting platform-admin clearance."
- `templatePreviewTitle`: "Template (sent in tenant's default language)"
- `submit`: "Launch reconfirmation campaign"
- `audiencePreviewHelp`: "First {n} contacts (sorted by most recent consent capture):"
- `campaignCardLabel`: "Re-confirmation"

## Test plan (TDD strictly)

| Layer | Test |
|---|---|
| Domain pure | `is-green-for-at-least.test.ts` — no events, only-GREEN >=7d, GREEN→YELLOW→GREEN within 7d (rejects), GREEN→YELLOW→GREEN gap >7d (allows), current=YELLOW (rejects). |
| Use case | `check-reconfirmation-eligibility.test.ts` — happy path; quality not green; empty audience; daily cap met; auto-paused. |
| Use case | `resolve-reconfirmation-audience.test.ts` — sorts captured_at DESC; limits to remaining cap; only weak+opted_in+marketing. |
| Use case | `execute-reconfirmation-batch.test.ts` — wraps execute-campaign-batch; forces utility template; defence-in-depth per-row re-check. |
| Use case | `confirm-reconfirmation-consent.test.ts` — happy weak→strong; idempotent (already strong → returns false); concurrent (race protected by row lock + WHERE clause). |
| Repo | `tenant_green_for_days` RPC happy + 4 edge cases (mocked supabase). |
| Repo | `upgradeGradeToStrong` happy; idempotent; respects category filter. |
| API | `/preflight` 200 with breakdown; 401/403 on auth fail. |
| API | `/campaigns POST mode='reconfirmation'` runs preflight; rejects 400 if not allowed; forces utility template. |
| API | `/admin/.../resume` platform-admin only (403 for tenant-manager); re-runs preflight before resume. |
| API | `PATCH /admin/.../campaign-settings reconfirmation_daily_cap` accepts 50–100; 400 outside range. |
| Webhook | `handleReconfirmationConsent` upgrades weak→strong on YES; pending receipt YES still wins; opt-in pending YES handled before reconfirmation. |
| End-to-end | Campaign sends to 3 weak+opted_in; one YES → upgraded; one NO → revoked; one no reply → unchanged. |
| Race | Quality drops YELLOW mid-campaign → next batch refuses; auto-pause flips; tenant-manager attempts manual resume → 403; platform-admin resumes after GREEN restored. |
| Cap interaction | Two reconfirmation campaigns running simultaneously share the per-tenant cap (50). |
| Audience purity | Audience excludes opted_out, weak+pending, strong, none. Only weak+opted_in. |
| Template enforcement | Reject if template category != utility (mirrors WONB-007 pattern). |

## Files to create / modify

### Create
- `supabase/migrations/050_campaign_mode_reconfirmation.sql`
- `src/domain/services/is-green-for-at-least.ts` + tests
- `src/application/check-reconfirmation-eligibility.ts` + tests
- `src/application/resolve-reconfirmation-audience.ts` + tests
- `src/application/execute-reconfirmation-batch.ts` + tests
- `src/application/confirm-reconfirmation-consent.ts` + tests
- `src/app/api/dashboard/campaigns/reconfirmation/preflight/route.ts` + tests
- `src/app/api/admin/tenants/[id]/campaigns/[campaignId]/reconfirmation/resume/route.ts` + tests
- `src/app/api/webhooks/whatsapp/reconfirmation-consent.ts` (handleReconfirmationConsent) + tests
- `src/components/dashboard/reconfirmation-campaign-dialog.tsx`
- `src/components/dashboard/reconfirmation-status-badge.tsx`
- `src/hooks/use-reconfirmation-preflight.ts`

### Modify
- `src/domain/entities/campaign.ts` — add `mode: 'marketing' | 'reconfirmation'`
- `src/infrastructure/supabase/repositories/campaign-mapper.ts` — read/write `mode`
- `src/infrastructure/supabase/repositories/consent-record-repository.ts` — add `countByGradeStatus` + `upgradeGradeToStrong`
- `src/infrastructure/supabase/repositories/quality-state-repository.ts` — add `isGreenForDays` wrapper
- `src/infrastructure/supabase/repositories/tenant-campaign-settings-repository.ts` (or equivalent) — read `reconfirmation_daily_cap`; admin update method
- `src/app/api/dashboard/campaigns/route.ts` + parse helper — accept `mode`; force utility for reconfirmation
- `src/app/api/admin/tenants/[id]/campaign-settings/route.ts` (or create) — PATCH for `reconfirmation_daily_cap`
- `src/application/execute-campaign.ts` — branch on `campaign.mode`
- `src/app/api/webhooks/whatsapp/handlers.ts::dispatchConfirmation` — add reconfirmation YES try after WONB-007 opt-in
- `src/app/dashboard/campaigns/page.tsx` — add second button + dialog
- `src/messages/en.json`, `src/messages/zh-HK.json` — `reconfirmation.*` keys

## Independent work streams

A blocks B; B blocks C; D mocks B for parallel scaffolding.

| Stream | Owner | Scope |
|---|---|---|
| **A — Migration + RPC + domain pure + repo extensions** | senior-backend-dev | Migration 050 (mode column + cap column + RPC), `is-green-for-at-least`, `countByGradeStatus`, `upgradeGradeToStrong`, `isGreenForDays` wrapper. Tests. |
| **B — Eligibility + audience + reconfirmation use case + execute branching** | senior-backend-dev | `check-reconfirmation-eligibility`, `resolve-reconfirmation-audience`, `execute-reconfirmation-batch`, `confirm-reconfirmation-consent`, `execute-campaign` branch on mode. |
| **C — API routes + webhook handler + handlers.ts dispatch** | senior-backend-dev | `/preflight`, `/campaigns POST` extension, `/admin/.../resume`, `PATCH .../campaign-settings`, `handleReconfirmationConsent`, `dispatchConfirmation` extension. |
| **D — Dialog + badge + hook + button wiring** | react-frontend-dev | Dialog, badge, hook, second button on campaigns page, i18n. Mocks B's contract until it lands. |

All streams blocked behind A; A is small (~0.5d) so dispatch sequentially.

## Out of scope
- **Multi-day pacing logic** beyond 50/day per day (no ramp-up automation post-stable-GREEN).
- **Email/SMS bridge** (Strategy D) — separate post-launch task.
- **QR PDF generator** (Strategy A frontend) → WONB-006 (post-launch).
- **Block reason ingestion** → WONB-010 (post-launch).
- **Per-tenant template customisation UI** — manual ops via WAQ-011 review queue for now.
- **Strategy A audience (`grade='strong' AND status='pending'`)** — out of scope for WONB-008 per Q-P; can be a follow-up if WONB-007 produces enough non-responders to warrant.
