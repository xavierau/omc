-- REPLY-007: per-tenant WhatsApp Flow id for the contact-us form.
-- WhatsApp Flows are WABA-scoped and each tenant has their OWN WABA
-- (kanban Q1, 2026-05-04), so REPLY-005's single WHATSAPP_CONTACT_FLOW_ID
-- env var could only ever address one tenant's WABA. The committed Flow JSON
-- is deployed once per tenant WABA; the resulting flow id lives here.
-- Dedicated column beside meta_business_account_id — deliberately NOT inside
-- contact_config: this value is machine-written by the deploy routine, while
-- contact_config is admin-owned and full-replaced by its PATCH (a settings
-- save must never clobber a deployed flow id). NULL = never deployed =>
-- contact-handler degrades to the wa.me redirect path. Read via a dedicated
-- degrade-safe query, deliberately NOT added to RESTAURANT_COLUMNS (hot-path
-- migration coupling). No RLS change: inherits restaurants row policies.
ALTER TABLE restaurants
  ADD COLUMN whatsapp_contact_flow_id TEXT;
