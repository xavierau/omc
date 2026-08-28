-- 052: RLS for stamp tables (REL-001 release review)
--
-- Migration 050 created stamp_campaigns and member_stamp_cards without RLS,
-- leaving both cross-tenant readable AND writable through PostgREST with the
-- anon key. Writes stay service-role-only (apply_stamp / reverse_stamp RPCs
-- bypass RLS); dashboard reads get the standard tenant-scoped SELECT policy
-- used by every other tenant table in this release (038/044 pattern).

ALTER TABLE stamp_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY stamp_campaigns_select ON stamp_campaigns
  FOR SELECT USING (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );

ALTER TABLE member_stamp_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY member_stamp_cards_select ON member_stamp_cards
  FOR SELECT USING (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );
