-- 080_member_delivery_quality.sql
-- MEM-001: per-contact delivery quality for the dashboard members table.
--
-- Returns delivered/failed outbound counts per member over a trailing window,
-- computed inside the database so the member ids never travel back out through
-- a PostgREST .in() filter (the URL is echoed in a response header and
-- overflows at ~390 uuids; see 079_active_members_rpcs.sql).
--
--   delivered = status IN ('delivered','read'); failed = status = 'failed'.
--   queued/sent are pending and excluded. Rating/threshold logic lives in
--   src/domain/value-objects/contact-quality.ts, which also owns the window
--   (passed as p_window_days so there is one source for the number).
--
-- Tenant scoping: the members join filters m.restaurant_id AND the message
-- join filters w.restaurant_id, so another tenant's member ids yield no rows.
--
-- Writer/caller: SOLE caller is the service-role client at
-- src/infrastructure/supabase/repositories/member-delivery-quality.ts.

CREATE OR REPLACE FUNCTION public.member_delivery_quality(
  p_restaurant_id uuid,
  p_member_ids uuid[],
  p_window_days int DEFAULT 90
)
RETURNS TABLE (member_id uuid, delivered bigint, failed bigint)
LANGUAGE sql STABLE AS $$
  SELECT m.id,
         count(w.id) FILTER (WHERE w.status IN ('delivered', 'read')),
         count(w.id) FILTER (WHERE w.status = 'failed')
    FROM members m
    LEFT JOIN whatsapp_messages w
      ON w.member_id = m.id
     AND w.restaurant_id = p_restaurant_id
     AND w.direction = 'outbound'
     AND w.queued_at >= now() - make_interval(days => p_window_days)
   WHERE m.restaurant_id = p_restaurant_id
     AND m.id = ANY(p_member_ids)
   GROUP BY m.id
$$;

REVOKE EXECUTE ON FUNCTION public.member_delivery_quality(uuid, uuid[], int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.member_delivery_quality(uuid, uuid[], int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.member_delivery_quality(uuid, uuid[], int) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.member_delivery_quality(uuid, uuid[], int) TO service_role;

-- Supports the per-member lookup above; none existed on member_id.
CREATE INDEX IF NOT EXISTS idx_wa_messages_member_queued
  ON whatsapp_messages(member_id, queued_at)
  WHERE member_id IS NOT NULL AND direction = 'outbound';
