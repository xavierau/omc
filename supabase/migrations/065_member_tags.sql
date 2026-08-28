-- TAG-001: tenant-scoped member tags.
--
-- `tags` are tenant-owned labels; `member_tags` is the N:M association between
-- members and tags. Name uniqueness per restaurant is case-insensitive
-- (idx_tags_restaurant_lower_name) while the display value keeps the entered case;
-- the app maps the unique-violation (23505) to a 409 conflict.
--
-- Writer: SOLE writers are the service-role clients at
--   src/infrastructure/supabase/repositories/tag-repository.ts
--   src/infrastructure/supabase/repositories/member-tag-repository.ts
-- which bypass RLS. The SELECT policies below are for tenant dashboards and
-- platform-admin read access only — there are intentionally no INSERT/UPDATE/
-- DELETE policies (browser-side writes are not supported). Mirrors 048/052.

CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  color TEXT NOT NULL DEFAULT '#6B7280',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Case-insensitive uniqueness per tenant; display keeps original case.
CREATE UNIQUE INDEX idx_tags_restaurant_lower_name ON tags(restaurant_id, lower(name));
CREATE INDEX idx_tags_restaurant ON tags(restaurant_id);

CREATE TABLE member_tags (
  member_id     UUID NOT NULL REFERENCES members(id)      ON DELETE CASCADE,
  tag_id        UUID NOT NULL REFERENCES tags(id)         ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id)  ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, tag_id)
);
CREATE INDEX idx_member_tags_tag ON member_tags(tag_id);            -- reverse lookup (tag -> members)
CREATE INDEX idx_member_tags_restaurant ON member_tags(restaurant_id);

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY tags_select ON tags
  FOR SELECT USING (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );

ALTER TABLE member_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY member_tags_select ON member_tags
  FOR SELECT USING (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );
-- Writes via service-role client only. No INSERT/UPDATE/DELETE policies.
