-- REPLY-005: per-restaurant "Contact us" mode + WhatsApp-Flow form settings.
-- Single JSONB following the reply_config precedent (057): shape/merge/validate
-- live in src/domain/services/contact-config.ts; read via a dedicated
-- degrade-safe query, deliberately NOT in the shared RESTAURANT_COLUMNS select.
-- DEFAULT '{}' => resolves to { mode: 'redirect', defaults } — existing tenants
-- keep today's wa.me redirect behaviour with zero change. No RLS change:
-- inherits existing restaurants row policies (same as 054/057).
ALTER TABLE restaurants
  ADD COLUMN contact_config JSONB NOT NULL DEFAULT '{}'::jsonb;
