-- INT-001 WI-1: per-integration settings for the partner member-creation API.
--
-- One row per pos_integrations row (1:1, integration_id is the PK). Holds the
-- welcome-template selection, the OD-13 consent attestation, and the outbound
-- webhook configuration (URL, encrypted signing secret, subscribed events,
-- PII acknowledgement, breaker state).
--
-- Writer: SOLE writer is the service-role client at
--   src/infrastructure/supabase/repositories/integration-settings-repository.ts
-- RLS is service-role-only — unlike consent_records/tags there is no tenant
-- SELECT policy, because the row carries `outbound_secret_enc` (T-H1): any
-- policy that exposes the row to a browser-authenticated tenant session
-- re-opens the leak this migration exists to close. Dashboards read through
-- `toPublicIntegration()` (WI-0/WI-8), never this table directly.

CREATE TABLE integration_settings (
  integration_id UUID PRIMARY KEY REFERENCES pos_integrations(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,

  -- Welcome template selection (D2-D5): NULL = off, 'default' = tenant's
  -- onboarding welcome template, uuid = a specific whatsapp_templates.id.
  new_join_template_id TEXT
    CHECK (
      new_join_template_id IS NULL
      OR new_join_template_id = 'default'
      OR new_join_template_id ~ '^[0-9a-f-]{36}$'
    ),

  -- OD-13: partner consent evidence. Present + acknowledged -> consent rows
  -- grade 'strong' and copy this text into consent_text_shown; absent ->
  -- grade 'weak'. Decision lives in the caller (WI-3); this table just holds
  -- the owner-entered text and the acknowledgement stamp.
  consent_attestation_text TEXT,
  consent_attestation_ack_at TIMESTAMPTZ,
  consent_attestation_ack_by UUID,

  -- Outbound webhook (US-6/US-9). Secret is AES-256-GCM encrypted
  -- (src/infrastructure/crypto/secret-box.ts) — never plaintext at rest, and
  -- the mapper (WI-1) never maps this column onto the entity (T-H1).
  outbound_url TEXT,
  outbound_secret_enc TEXT,
  outbound_secret_last4 TEXT,
  outbound_secret_updated_at TIMESTAMPTZ,
  outbound_secret_updated_by UUID,
  outbound_events TEXT[] NOT NULL DEFAULT '{member.created}',
  outbound_enabled BOOLEAN NOT NULL DEFAULT false,
  outbound_pii_ack_at TIMESTAMPTZ,
  outbound_pii_ack_by UUID,
  outbound_status TEXT NOT NULL DEFAULT 'active'
    CHECK (outbound_status IN ('active', 'paused_auto', 'paused_manual')),
  outbound_failure_streak INT NOT NULL DEFAULT 0,
  outbound_paused_at TIMESTAMPTZ,

  -- Per-integration overrides of the platform defaults (WI-2); NULL = use
  -- the env-configured default.
  inbound_rate_per_min INT,
  inbound_burst INT,
  inbound_queue_cap INT,
  inbound_secret_updated_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_integration_settings_restaurant ON integration_settings(restaurant_id);

CREATE TRIGGER set_integration_settings_updated_at
  BEFORE UPDATE ON integration_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Field-level audit trail for every settings mutation (WI-8). Secrets are
-- logged as last4 only — never the plaintext or the ciphertext.
CREATE TABLE integration_settings_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID NOT NULL REFERENCES pos_integrations(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  actor_user_id UUID,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_integration_settings_audit_integration
  ON integration_settings_audit(integration_id, created_at DESC);

ALTER TABLE integration_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_settings_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY integration_settings_service
  ON integration_settings FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY integration_settings_audit_service
  ON integration_settings_audit FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Backfill: one row per existing pos_integrations row, all defaults (OD-3:
-- every field starts null/off — an integration must be explicitly configured
-- before it sends a welcome or an outbound webhook).
INSERT INTO integration_settings (integration_id, restaurant_id)
SELECT id, restaurant_id FROM pos_integrations
ON CONFLICT DO NOTHING;
