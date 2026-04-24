BEGIN;

-- ONBOARD-010: bilingual image attachments for welcome campaigns.
-- Strict per-language match at send time (no cross-language fallback),
-- so either column may be populated independently. Both nullable because
-- an image is always optional.
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS image_url_en TEXT NULL,
  ADD COLUMN IF NOT EXISTS image_url_zh_hk TEXT NULL;

-- Public bucket: WhatsApp Cloud API requires a publicly-fetchable URL
-- to render the image header. ON CONFLICT guards re-runs.
INSERT INTO storage.buckets (id, name, public)
  VALUES ('campaign-images', 'campaign-images', true)
  ON CONFLICT (id) DO NOTHING;

-- RLS: tenants may write/update/delete only under their own
-- {restaurantId}/ prefix. Read is implicitly public via the bucket's
-- public flag (the public URL is shipped to WhatsApp).
DO $$ BEGIN
  CREATE POLICY campaign_images_tenant_write ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'campaign-images'
      AND (
        (storage.foldername(name))[1] IN (SELECT user_restaurant_ids())
        OR is_platform_admin()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY campaign_images_tenant_update ON storage.objects
    FOR UPDATE TO authenticated
    USING (
      bucket_id = 'campaign-images'
      AND (
        (storage.foldername(name))[1] IN (SELECT user_restaurant_ids())
        OR is_platform_admin()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY campaign_images_tenant_delete ON storage.objects
    FOR DELETE TO authenticated
    USING (
      bucket_id = 'campaign-images'
      AND (
        (storage.foldername(name))[1] IN (SELECT user_restaurant_ids())
        OR is_platform_admin()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
