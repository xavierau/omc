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
-- Pattern mirrors 045_quality_kpi_rpcs.sql: STABLE + SECURITY DEFINER, locked to
-- service_role. Server routes authenticate the caller before invoking.
--
-- Q-H semantics: tenant must be GREEN now AND have been GREEN continuously for
-- ≥ p_min_days. Any non-GREEN transition within the last p_min_days disqualifies.
--   - latest_non_green: most recent non-GREEN event (NULL = always GREEN).
--   - earliest_green:   earliest GREEN event (anchor when never non-GREEN).
--   - current_state:    most recent transition.
-- The function returns TRUE iff the current state is GREEN AND either:
--   (a) no non-GREEN row has ever been recorded AND the earliest GREEN row is
--       ≥ p_min_days old, OR
--   (b) the latest non-GREEN row is ≥ p_min_days old (so the GREEN streak
--       since then has lasted at least p_min_days).
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
