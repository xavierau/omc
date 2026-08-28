-- TAG-001: campaign target-by-tag.
--
-- Extend the audience enum with 'tag' and add the `campaign_tags` link table.
-- A tag link is expanded to its current members at SEND time
-- (src/application/resolve-campaign-members.ts), so members tagged after the
-- campaign is created are included (dynamic membership) — this mirrors the
-- existing 'selected' + campaign_members convention.
--
-- The 'all'/'selected' CHECK from migration 015 was added as an unnamed inline
-- column constraint, which Postgres auto-names `campaigns_target_audience_check`.
--
-- Writer: SOLE writer is the service-role client at
--   src/infrastructure/supabase/repositories/campaign-tags-repository.ts
-- which bypasses RLS. The SELECT policy below is read-only for tenant dashboards
-- and platform admins — no INSERT/UPDATE/DELETE policies. Mirrors 048/052.

ALTER TABLE campaigns DROP CONSTRAINT campaigns_target_audience_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_target_audience_check
  CHECK (target_audience IN ('all', 'selected', 'tag'));

CREATE TABLE campaign_tags (
  campaign_id   UUID NOT NULL REFERENCES campaigns(id)     ON DELETE CASCADE,
  tag_id        UUID NOT NULL REFERENCES tags(id)          ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id)   ON DELETE CASCADE,
  PRIMARY KEY (campaign_id, tag_id)
);
CREATE INDEX idx_campaign_tags_tag ON campaign_tags(tag_id);

ALTER TABLE campaign_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY campaign_tags_select ON campaign_tags
  FOR SELECT USING (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );
-- Writes via service-role client only. No INSERT/UPDATE/DELETE policies.
