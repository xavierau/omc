-- WAQ-012 review fix r1 (Fix 1): replace raw-row fetches with Postgres
-- aggregation. The previous client-side approach used `.select()` without
-- `.limit()`, hitting PostgREST's default 1000-row cap. A marketing-heavy
-- tenant easily exceeds that in 7 days; quality_state history grows
-- monotonically. Both paths produced silently-truncated KPIs at scale.
--
-- These RPCs do all aggregation server-side so each call is a single
-- round-trip with bounded result size:
--   * get_quality_kpis_for_tenant         — one row per call.
--   * get_quality_kpis_for_all_tenants    — one row per restaurant.
--   * get_latest_quality_states_for_tenants — one row per restaurant.
--
-- SECURITY: each function is STABLE + SECURITY DEFINER, locked to
-- service_role per the existing pattern (see 033_delete_member_rpc.sql).
-- Callers are server routes that have already authenticated the user;
-- exposing these to `authenticated` would let any logged-in browser
-- session pull cross-tenant aggregates.

CREATE OR REPLACE FUNCTION get_quality_kpis_for_tenant(
  p_restaurant_id UUID,
  p_since TIMESTAMPTZ
)
RETURNS TABLE (
  total_sends BIGINT,
  delivered BIGINT,
  read_count BIGINT,
  failed BIGINT,
  opted_out BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE((SELECT count(*) FROM whatsapp_messages
       WHERE restaurant_id = p_restaurant_id
         AND category = 'marketing'
         AND queued_at > p_since), 0)::BIGINT AS total_sends,
    COALESCE((SELECT count(*) FROM whatsapp_messages
       WHERE restaurant_id = p_restaurant_id
         AND category = 'marketing'
         AND queued_at > p_since
         AND status IN ('delivered', 'read')), 0)::BIGINT AS delivered,
    COALESCE((SELECT count(*) FROM whatsapp_messages
       WHERE restaurant_id = p_restaurant_id
         AND category = 'marketing'
         AND queued_at > p_since
         AND status = 'read'), 0)::BIGINT AS read_count,
    COALESCE((SELECT count(*) FROM whatsapp_messages
       WHERE restaurant_id = p_restaurant_id
         AND category = 'marketing'
         AND queued_at > p_since
         AND status = 'failed'), 0)::BIGINT AS failed,
    COALESCE((SELECT count(*) FROM consent_records
       WHERE restaurant_id = p_restaurant_id
         AND category = 'marketing'
         AND status = 'opted_out'
         AND revoked_at > p_since), 0)::BIGINT AS opted_out
$$;

CREATE OR REPLACE FUNCTION get_quality_kpis_for_all_tenants(
  p_since TIMESTAMPTZ
)
RETURNS TABLE (
  restaurant_id UUID,
  total_sends BIGINT,
  delivered BIGINT,
  read_count BIGINT,
  failed BIGINT,
  opted_out BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH msg AS (
    SELECT
      whatsapp_messages.restaurant_id AS rid,
      count(*) FILTER (WHERE TRUE) AS total_sends,
      count(*) FILTER (WHERE status IN ('delivered', 'read')) AS delivered,
      count(*) FILTER (WHERE status = 'read') AS read_count,
      count(*) FILTER (WHERE status = 'failed') AS failed
    FROM whatsapp_messages
    WHERE category = 'marketing'
      AND queued_at > p_since
    GROUP BY whatsapp_messages.restaurant_id
  ),
  oo AS (
    SELECT
      consent_records.restaurant_id AS rid,
      count(*) AS opted_out
    FROM consent_records
    WHERE category = 'marketing'
      AND status = 'opted_out'
      AND revoked_at > p_since
    GROUP BY consent_records.restaurant_id
  )
  SELECT
    COALESCE(msg.rid, oo.rid) AS restaurant_id,
    COALESCE(msg.total_sends, 0)::BIGINT AS total_sends,
    COALESCE(msg.delivered, 0)::BIGINT AS delivered,
    COALESCE(msg.read_count, 0)::BIGINT AS read_count,
    COALESCE(msg.failed, 0)::BIGINT AS failed,
    COALESCE(oo.opted_out, 0)::BIGINT AS opted_out
  FROM msg FULL OUTER JOIN oo ON msg.rid = oo.rid
$$;

-- Latest quality_state per restaurant (DISTINCT ON pattern, server-side).
-- Accepts an optional restaurant filter so the per-tenant overview path
-- doesn't pull every tenant's row when scoping a single restaurant.
-- Pass NULL to get every restaurant; pass an array to filter.
CREATE OR REPLACE FUNCTION get_latest_quality_states_for_tenants(
  p_restaurant_ids UUID[]
)
RETURNS TABLE (
  restaurant_id UUID,
  quality_rating TEXT,
  messaging_tier TEXT,
  transitioned_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT ON (tqs.restaurant_id)
    tqs.restaurant_id,
    tqs.quality_rating,
    tqs.messaging_tier,
    tqs.transitioned_at
  FROM tenant_quality_state tqs
  WHERE p_restaurant_ids IS NULL
     OR tqs.restaurant_id = ANY(p_restaurant_ids)
  ORDER BY tqs.restaurant_id, tqs.transitioned_at DESC, tqs.created_at DESC
$$;

-- Lock down execution: SECURITY DEFINER + broad grant would let any
-- logged-in browser session pull these aggregates directly. Restrict to
-- service_role; server routes already authenticate the caller before
-- invoking these helpers.
REVOKE EXECUTE ON FUNCTION public.get_quality_kpis_for_tenant(UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_quality_kpis_for_tenant(UUID, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_quality_kpis_for_tenant(UUID, TIMESTAMPTZ) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_quality_kpis_for_all_tenants(TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_quality_kpis_for_all_tenants(TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_quality_kpis_for_all_tenants(TIMESTAMPTZ) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_latest_quality_states_for_tenants(UUID[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_latest_quality_states_for_tenants(UUID[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_latest_quality_states_for_tenants(UUID[]) TO service_role;
