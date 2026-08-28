-- 067_count_active_members_by_tags.sql
-- TAG-001 / #138b: live recipient count for campaign tag-targeting.
--
-- The naive shape (member_tags ids -> .in('id', memberIds) on members from
-- JS) blows the PostgREST URL length once a tag covers a few thousand
-- members, and a PostgREST !inner embed with count:'exact' OVER-COUNTS a
-- member carrying more than one of the selected tags. This function returns
-- count(DISTINCT m.id) in one round trip, exactly, with no URL limit.
--
-- Both restaurant_id predicates are deliberate: a poisoned
-- member_tags.restaurant_id row must not leak another tenant's member into
-- the count (mirrors the resolve-campaign-members.ts tag branch, which
-- scopes member_tags by restaurant_id for the same reason).
--
-- Writer/caller: SOLE caller is the service-role client at
--   src/infrastructure/supabase/repositories/tag-audience-repository.ts
-- via GET /api/dashboard/tags/recipient-count, which re-asserts every
-- tag id belongs to the caller's tenant (assertTagsBelongToTenant) before
-- calling this function. Locked down with the migration-064 REVOKE/GRANT
-- pattern: under Supabase's default EXECUTE TO PUBLIC a dashboard session
-- could otherwise probe another tenant's tag membership counts directly.

CREATE OR REPLACE FUNCTION public.count_active_members_by_tags(
  p_restaurant_id uuid, p_tag_ids uuid[]
) RETURNS integer AS $$
  SELECT count(DISTINCT m.id)::int
  FROM member_tags mt
  JOIN members m ON m.id = mt.member_id
  WHERE mt.restaurant_id = p_restaurant_id
    AND m.restaurant_id  = p_restaurant_id
    AND m.status = 'active'
    AND mt.tag_id = ANY(p_tag_ids);
$$ LANGUAGE sql STABLE;

REVOKE EXECUTE ON FUNCTION public.count_active_members_by_tags(uuid, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.count_active_members_by_tags(uuid, uuid[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.count_active_members_by_tags(uuid, uuid[]) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.count_active_members_by_tags(uuid, uuid[]) TO service_role;
