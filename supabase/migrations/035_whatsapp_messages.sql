-- WAQ-001: per-message status tracking.
-- One row per WhatsApp message we send (and, optionally later, receive).
-- Updated in-place by the outbound status webhook handler (WAQ-002).
--
-- Writer: SOLE writer is the service-role client at
--   src/infrastructure/supabase/repositories/whatsapp-message-repository.ts
-- which bypasses RLS. The SELECT policy below is for tenant dashboards and
-- platform-admin read access only — there are intentionally no INSERT or
-- UPDATE policies (browser-side writes are not supported).

CREATE TABLE whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  member_id UUID REFERENCES members(id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,

  -- Routing identity
  phone_e164 TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),

  -- Classification (drives cooldown / PMM logic in WAQ-007+)
  category TEXT NOT NULL
    CHECK (category IN ('marketing', 'utility', 'authentication', 'service')),

  -- Content shape
  message_type TEXT NOT NULL
    CHECK (message_type IN ('text', 'image', 'template', 'interactive')),
  template_id UUID REFERENCES whatsapp_templates(id) ON DELETE SET NULL,
  template_name TEXT,
  content_preview TEXT,

  -- BSP correlation
  kapso_message_id TEXT UNIQUE,
  raw_send_response JSONB,

  -- State machine: queued < sent < delivered < read; failed reachable from
  -- any non-read state. Enforced application-side in WhatsAppMessage.
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed')),
  error_code TEXT,
  error_title TEXT,
  error_details TEXT,
  raw_status_payload JSONB,

  -- Timestamps (NULL until that transition occurs)
  queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-campaign delivery rate (campaign analytics)
CREATE INDEX idx_wa_messages_campaign_status
  ON whatsapp_messages(campaign_id, status)
  WHERE campaign_id IS NOT NULL;

-- Per-tenant 7d read rate, error-code rate alerts
CREATE INDEX idx_wa_messages_restaurant_sent_at
  ON whatsapp_messages(restaurant_id, sent_at DESC)
  WHERE sent_at IS NOT NULL;

-- Failed-error-code monitoring (for §6 error dispatch and WAQ-009 alerts)
CREATE INDEX idx_wa_messages_error_code
  ON whatsapp_messages(restaurant_id, error_code, failed_at DESC)
  WHERE error_code IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Trigger function rename: 016 named the trigger function
-- update_campaign_settings_updated_at(). Generalise it to update_updated_at_column()
-- so any table can reuse it. CREATE OR REPLACE keeps tenant_campaign_settings
-- working through the rebind below.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Rebind the existing tenant_campaign_settings trigger to the new function
-- before dropping the legacy one.
DROP TRIGGER IF EXISTS set_campaign_settings_updated_at ON tenant_campaign_settings;
CREATE TRIGGER set_campaign_settings_updated_at
  BEFORE UPDATE ON tenant_campaign_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP FUNCTION IF EXISTS update_campaign_settings_updated_at();

-- New trigger on whatsapp_messages
CREATE TRIGGER set_whatsapp_messages_updated_at
  BEFORE UPDATE ON whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------------
-- RLS — SELECT-only (writes are service-role-bypassed; see top-of-file).
-- ---------------------------------------------------------------------------
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY whatsapp_messages_select ON whatsapp_messages
  FOR SELECT USING (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );
