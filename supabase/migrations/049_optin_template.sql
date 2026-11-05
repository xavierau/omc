-- WONB-007: tenant override for the inbound-first opt-in confirmation
-- template. Nullable; when null, prompt-marketing-optin falls back to the
-- platform default in `KAPSO_DEFAULT_OPTIN_TEMPLATE_ID`. No FK so admins can
-- soft-delete a template row without breaking unrelated tenants — the
-- runtime resolver re-validates on every send.
ALTER TABLE tenant_campaign_settings
  ADD COLUMN optin_confirmation_template_id UUID;

COMMENT ON COLUMN tenant_campaign_settings.optin_confirmation_template_id IS
  'WONB-007: optional tenant-specific opt-in confirmation template id. NULL falls back to the platform default env var KAPSO_DEFAULT_OPTIN_TEMPLATE_ID.';
