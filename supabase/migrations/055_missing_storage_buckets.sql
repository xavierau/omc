BEGIN;

-- Provision storage buckets that runtime code expects but no migration ever
-- created. Discovered when onboarding a fresh production project and getting
-- "Bucket not found" on (a) coupon QR send during member onboarding and
-- (b) WhatsApp template / tenant logo image upload from the dashboard.
--
-- All three are public so URLs can be fetched directly by WhatsApp Cloud API
-- (image media) or rendered in browser tabs (logos). All writes happen
-- server-side via the service role (see src/infrastructure/supabase/storage.ts
-- and src/app/api/dashboard/upload/route.ts). RLS on storage.objects defaults
-- to deny without a matching policy, which keeps anon and non-service-role
-- writes blocked — no per-tenant policies needed.
INSERT INTO storage.buckets (id, name, public) VALUES
  ('coupon-qr', 'coupon-qr', true),
  ('wa-template-media', 'wa-template-media', true),
  ('tenant-assets', 'tenant-assets', true)
  ON CONFLICT (id) DO NOTHING;

COMMIT;
