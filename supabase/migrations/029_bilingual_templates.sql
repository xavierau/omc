BEGIN;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS template_en TEXT NULL,
  ADD COLUMN IF NOT EXISTS template_zh_hk TEXT NULL;

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS returning_member_template_en TEXT NULL,
  ADD COLUMN IF NOT EXISTS returning_member_template_zh_hk TEXT NULL;

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS default_language TEXT NOT NULL DEFAULT 'zh_hk';

-- Attach CHECK idempotently
DO $$ BEGIN
  ALTER TABLE restaurants
    ADD CONSTRAINT restaurants_default_language_chk
    CHECK (default_language IN ('en','zh_hk'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Backfill HK market default. Only sets where dest is null and src has content. Idempotent.
UPDATE campaigns
  SET template_zh_hk = template
  WHERE template_zh_hk IS NULL AND template IS NOT NULL AND template <> '';

UPDATE restaurants
  SET returning_member_template_zh_hk = returning_member_template
  WHERE returning_member_template_zh_hk IS NULL
    AND returning_member_template IS NOT NULL
    AND returning_member_template <> '';

-- Legacy columns (campaigns.template, restaurants.returning_member_template) stay for
-- rolling-deploy safety. ONBOARD-005b will drop them once deploy window closes.

COMMIT;
