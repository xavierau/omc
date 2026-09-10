-- 051_stamp_cap_policy.sql  (stamp-collection Phase C — configurable cap policy)
--
-- FOUNDER DECISION (2026-06-10, plan §9): the per-campaign max_stamps_per_day knob
-- is owner-configurable, and the GUARDRAIL on raising it is ITSELF configurable —
-- platform-admin level for MVP (per-tenant / per-plan override deferred to v2, YAGNI).
--
-- STORAGE DECISION: no singleton platform-settings surface exists today. The closest
-- candidates do NOT fit:
--   * tenant_campaign_settings (016) is PER-restaurant (UNIQUE restaurant_id) — wrong
--     scope; using it would force the per-tenant model the plan explicitly defers.
--   * platform_admins (011) is a membership table, not a settings store.
-- So we add a minimal single-row platform_settings table. The single-row invariant is
-- enforced by a one-value CHECK on a fixed primary key (no second row possible).
--
-- RLS: platform-admins write; readable by any authenticated user (the campaign editor
-- needs the policy to warn/block at save). The two values are non-sensitive policy
-- knobs (no PII, no secrets).

CREATE TABLE platform_settings (
  -- Fixed single-row sentinel: only one row can ever exist.
  id                       BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
  stamp_cap_enforcement    TEXT NOT NULL DEFAULT 'warn'
                             CHECK (stamp_cap_enforcement IN ('off','warn','block')),
  stamp_cap_warn_threshold INT  NOT NULL DEFAULT 1
                             CHECK (stamp_cap_warn_threshold >= 1),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_platform_settings_updated_at
  BEFORE UPDATE ON platform_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Seed the single row with the founder-default policy (warn at threshold 1).
INSERT INTO platform_settings (id) VALUES (TRUE);

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

-- Any authenticated tenant member can READ the policy (campaign editor enforcement).
CREATE POLICY platform_settings_select ON platform_settings
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Only platform-admins may CHANGE the policy.
CREATE POLICY platform_settings_update ON platform_settings
  FOR UPDATE USING (is_platform_admin()) WITH CHECK (is_platform_admin());
