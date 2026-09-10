-- 079_active_members_rpcs.sql
-- #162 / CAMP-013: resolve a campaign's recipients INSIDE the database
-- instead of shipping every member UUID out to the worker and straight back
-- in through a URL filter.
--
-- The failure is not request-side. PostgREST accepts an 18.6 KB URL, then
-- echoes the whole query back in the `content-location` RESPONSE header,
-- URL-encoded (every `,` becomes `%2C`). undici parses response headers
-- against maxHeaderSize = 16384 and aborts: measured on prod, 390 ids =
-- 16,137 header bytes (ok), 400 ids = 16,527 (UND_ERR_HEADERS_OVERFLOW).
-- The worker saw `fetchMembersByIds: TypeError: fetch failed` and the
-- merchant saw a terminally failed campaign. Any chunk constant is a guess
-- against an encoding detail of a header we do not control; a set-returning
-- RPC (ids never leave the database) has no such limit to guess against.
--
-- Sibling of 067_count_active_members_by_tags, which fixed exactly this for
-- the recipient COUNT. The tags function's FROM/WHERE text is deliberately
-- character-identical to 067's: the count the merchant is shown and the set
-- actually sent to must come from the same predicate, and that parity is
-- asserted structurally by
-- src/infrastructure/supabase/repositories/__tests__/recipient-rpc-migration-contract.test.ts.
--
-- Carried over from 067:
--   * BOTH restaurant_id predicates on the tags function -- a poisoned
--     member_tags.restaurant_id row must not leak another tenant's member
--     into a send.
--   * DISTINCT ON (m.id) to match count(DISTINCT m.id): a member carrying
--     two selected tags is ONE recipient, never a double send.
--   * The migration-064 REVOKE PUBLIC/anon/authenticated + GRANT
--     service_role lockdown. Under Supabase's default EXECUTE TO PUBLIC a
--     dashboard session could otherwise read another tenant's member PII
--     (phone numbers) straight out of these functions.
--
-- D4 (plan): the selection function filters m.status = 'active' too. The
-- CHECK on members.status is ('active','unsubscribed') (001) and
-- execute-campaign.ts:47 already drops unsubscribed rows before the
-- guardrail count, so the recipient set is unchanged -- but no unsubscribed
-- member's PII is shipped to the worker any more, and :47 stays as defence
-- in depth.
--
-- D7 (plan): paging is p_limit/p_offset, walked by readAllPages
-- (resolve-campaign-members-chunks.ts). A set-returning RPC is still
-- subject to PostgREST `max-rows`, so the loop ends only on an EMPTY page
-- and advances by rows RECEIVED; ORDER BY m.id is the total order that
-- makes those offsets stable across requests.
--
-- Why the selection function scopes through campaigns.restaurant_id:
-- campaign_members is (campaign_id, member_id) only -- migration 015 gave
-- it no restaurant_id column -- so the tenant predicate has to come from
-- the campaign row. No DISTINCT is needed: (campaign_id, member_id) is the
-- primary key, so the join cannot duplicate a member.
--
-- Writer/caller: SOLE caller of both is the service-role client at
-- src/application/resolve-campaign-members.ts (worker send path).

CREATE OR REPLACE FUNCTION public.active_members_by_tags(
  p_restaurant_id uuid,
  p_tag_ids uuid[],
  p_limit int DEFAULT NULL,
  p_offset int DEFAULT 0
) RETURNS TABLE (
  id uuid,
  restaurant_id uuid,
  phone text,
  name text,
  points_balance int,
  status text,
  joined_at timestamptz,
  last_visit_at timestamptz,
  preferred_language text,
  pmm_throttled_until timestamptz,
  unreachable_at timestamptz
) AS $$
  SELECT DISTINCT ON (m.id)
         m.id, m.restaurant_id, m.phone, m.name, m.points_balance,
         m.status, m.joined_at, m.last_visit_at, m.preferred_language,
         m.pmm_throttled_until, m.unreachable_at
  FROM member_tags mt
  JOIN members m ON m.id = mt.member_id
  WHERE mt.restaurant_id = p_restaurant_id
    AND m.restaurant_id = p_restaurant_id
    AND m.status = 'active'
    AND mt.tag_id = ANY(p_tag_ids)
  ORDER BY m.id
  LIMIT p_limit OFFSET p_offset;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION public.active_members_by_campaign_selection(
  p_restaurant_id uuid,
  p_campaign_id uuid,
  p_limit int DEFAULT NULL,
  p_offset int DEFAULT 0
) RETURNS TABLE (
  id uuid,
  restaurant_id uuid,
  phone text,
  name text,
  points_balance int,
  status text,
  joined_at timestamptz,
  last_visit_at timestamptz,
  preferred_language text,
  pmm_throttled_until timestamptz,
  unreachable_at timestamptz
) AS $$
  SELECT m.id, m.restaurant_id, m.phone, m.name, m.points_balance,
         m.status, m.joined_at, m.last_visit_at, m.preferred_language,
         m.pmm_throttled_until, m.unreachable_at
  FROM campaign_members cm
  JOIN campaigns c ON c.id = cm.campaign_id
  JOIN members m ON m.id = cm.member_id
  WHERE cm.campaign_id = p_campaign_id
    AND c.restaurant_id = p_restaurant_id
    AND m.restaurant_id = p_restaurant_id
    AND m.status = 'active'
  ORDER BY m.id
  LIMIT p_limit OFFSET p_offset;
$$ LANGUAGE sql STABLE;

REVOKE EXECUTE ON FUNCTION public.active_members_by_tags(uuid, uuid[], int, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.active_members_by_tags(uuid, uuid[], int, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.active_members_by_tags(uuid, uuid[], int, int) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.active_members_by_tags(uuid, uuid[], int, int) TO service_role;

REVOKE EXECUTE ON FUNCTION public.active_members_by_campaign_selection(uuid, uuid, int, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.active_members_by_campaign_selection(uuid, uuid, int, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.active_members_by_campaign_selection(uuid, uuid, int, int) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.active_members_by_campaign_selection(uuid, uuid, int, int) TO service_role;
