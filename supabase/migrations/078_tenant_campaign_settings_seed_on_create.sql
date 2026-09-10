-- Issue #161 (CAMP-012): tenant_campaign_settings was EMPTY on prod for
-- every tenant. getSettingsForTenant() returns null and the guardrail
-- silently falls back to the hardcoded starter default (1,000/month),
-- regardless of the tenant's actual plan -- the only writer of the row
-- that enforces the real quota is changeTenantPlan(), reachable solely via
-- PATCH /api/admin/tenants/[id]/plan, which had never been invoked for any
-- tenant. This blocked a paying `growth` customer (Kushiro,
-- 96676002-4ba4-46cc-966c-061adc5d26f1) at the starter cap on 2026-09-10.
--
-- Fix mirrors 077 (integration_settings_seed_on_create) for the identical
-- bug class: an AFTER INSERT trigger on `restaurants` seeds the settings
-- row in the SAME transaction as the restaurant insert -- no window for a
-- concurrent read to observe "restaurant exists, settings row doesn't" --
-- plus an idempotent backfill for restaurants that already existed.
--
-- D6: `plan_monthly_send_limit` is a pure CASE (no data read), called by
-- both the trigger and the backfill so the numbers exist in exactly one
-- place. It must stay numerically identical to `planCampaignQuota` in
-- tenant-plan.ts -- enforced by a static test
-- (plan-quota-migration-contract.test.ts), not by trust. Not locked down
-- (no REVOKE/GRANT): unlike 064's data-touching RPCs, this reads nothing,
-- and revoking EXECUTE would break the trigger for any future non-service
-- -role inserter.
--
-- D1: there is deliberately NO trigger on UPDATE OF plan. changeTenantPlan
-- (the only reachable plan writer) already upserts the quota itself, and
-- update-tenant-campaign-settings.ts lets a platform admin hand-tune
-- monthly_send_limit -- an UPDATE-sync trigger would silently clobber that
-- override the next time the plan column is touched. `ON CONFLICT
-- (restaurant_id) DO NOTHING` is deliberately "create if absent, never
-- overwrite"; a raw SQL `UPDATE restaurants SET plan` outside the app
-- leaves the quota stale, same as today.
--
-- Risk (documented, not fixed here): the trigger function is plain plpgsql
-- (not SECURITY DEFINER), mirroring 077. `tenant_campaign_settings`'s
-- INSERT policy (016) requires `is_platform_admin()`; today the only
-- `restaurants` inserter is the service-role client, which bypasses RLS.
-- If a non-service-role path ever inserts into `restaurants`, this trigger
-- would need to become SECURITY DEFINER -- revisit then.

CREATE OR REPLACE FUNCTION public.plan_monthly_send_limit(p_plan text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_plan
    WHEN 'starter' THEN 1000
    WHEN 'growth' THEN 10000
    WHEN 'pro' THEN 100000
    ELSE 1000
  END;
$$;

CREATE OR REPLACE FUNCTION restaurant_seed_campaign_settings()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO tenant_campaign_settings (restaurant_id, monthly_send_limit)
  VALUES (NEW.id, plan_monthly_send_limit(NEW.plan))
  ON CONFLICT (restaurant_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_restaurant_seed_campaign_settings ON restaurants;
CREATE TRIGGER trg_restaurant_seed_campaign_settings
  AFTER INSERT ON restaurants
  FOR EACH ROW EXECUTE FUNCTION restaurant_seed_campaign_settings();

-- Backfill: every restaurant that existed before this trigger went live.
-- Idempotent (ON CONFLICT DO NOTHING against the UNIQUE restaurant_id) --
-- re-running this migration is a no-op the second time, and Kushiro's
-- existing hand-set row (monthly_send_limit 10000) is left untouched by
-- construction.
INSERT INTO tenant_campaign_settings (restaurant_id, monthly_send_limit)
SELECT id, plan_monthly_send_limit(plan) FROM restaurants
ON CONFLICT (restaurant_id) DO NOTHING;
