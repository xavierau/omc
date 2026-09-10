-- Per-tenant campaign settings for guardrails
CREATE TABLE tenant_campaign_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL UNIQUE REFERENCES restaurants(id) ON DELETE CASCADE,
  monthly_send_limit INTEGER NOT NULL DEFAULT 1000,
  daily_campaign_limit INTEGER NOT NULL DEFAULT 1,
  max_unsubscribe_rate NUMERIC(5,4) NOT NULL DEFAULT 0.0500,
  campaign_paused BOOLEAN NOT NULL DEFAULT false,
  paused_reason TEXT,
  paused_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE tenant_campaign_settings ENABLE ROW LEVEL SECURITY;

-- Tenant owner can read/update their own settings
CREATE POLICY campaign_settings_select ON tenant_campaign_settings
  FOR SELECT USING (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );
CREATE POLICY campaign_settings_update ON tenant_campaign_settings
  FOR UPDATE USING (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );

-- Platform admin can insert new settings
CREATE POLICY campaign_settings_insert ON tenant_campaign_settings
  FOR INSERT WITH CHECK (is_platform_admin());

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION update_campaign_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_campaign_settings_updated_at
  BEFORE UPDATE ON tenant_campaign_settings
  FOR EACH ROW EXECUTE FUNCTION update_campaign_settings_updated_at();

-- Index for admin queries on paused tenants
CREATE INDEX idx_campaign_settings_paused
  ON tenant_campaign_settings(campaign_paused) WHERE campaign_paused = true;
