-- 027_welcome_campaign_mapping.sql
-- ONBOARD-004: Customizable welcome campaign + non-chargeable billing flag.
--
-- Restaurants can now pick an active campaign as "the welcome campaign" and
-- customise the returning-member greeting. The welcome campaign is flagged
-- as non-chargeable: its broadcast sends and coupon redemptions must NOT
-- contribute to monthly billing.
--
-- The chargeability is stamped at send/stamp time (on the split sent_count
-- columns + coupons.is_chargeable) so remapping the welcome campaign later
-- never retroactively rewrites history.

BEGIN;

-- 1. restaurants: welcome-campaign mapping + returning-member template
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS welcome_campaign_id UUID NULL REFERENCES campaigns(id) ON DELETE SET NULL;

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS returning_member_template TEXT NULL;

-- 2. campaigns: non-chargeable flag + split sent counters
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS is_chargeable BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS chargeable_sent_count INT NOT NULL DEFAULT 0;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS non_chargeable_sent_count INT NOT NULL DEFAULT 0;

-- 3. coupons: stamped chargeability (defaults to billable; welcome stamps false)
ALTER TABLE coupons
  ADD COLUMN IF NOT EXISTS is_chargeable BOOLEAN NOT NULL DEFAULT true;

-- 4. Backfill: existing welcome-type campaigns are non-chargeable, and
--    their historical sent_count belongs in the non-chargeable bucket.
UPDATE campaigns SET is_chargeable = false WHERE type = 'welcome';

UPDATE campaigns
  SET non_chargeable_sent_count = sent_count
  WHERE type = 'welcome';

UPDATE campaigns
  SET chargeable_sent_count = sent_count
  WHERE type <> 'welcome';

-- 5. Backfill: map each restaurant's current active welcome campaign as default.
-- Restaurants with zero active welcome campaigns are left with
-- welcome_campaign_id = NULL; onboard-new-member / register-member-web
-- fall back to the hardcoded welcome coupon in that case.
UPDATE restaurants r
  SET welcome_campaign_id = (
    SELECT c.id
    FROM campaigns c
    WHERE c.restaurant_id = r.id
      AND c.type = 'welcome'
      AND c.status = 'active'
    ORDER BY c.created_at DESC
    LIMIT 1
  )
  WHERE welcome_campaign_id IS NULL;

-- 6. Backfill: coupons that came from welcome campaigns are non-chargeable.
UPDATE coupons
  SET is_chargeable = false
  WHERE campaign_id IN (
    SELECT id FROM campaigns WHERE type = 'welcome'
  );

-- 7. Legacy sent_count column is intentionally LEFT IN PLACE during this
-- migration. Rolling deploys may still have old app instances reading it;
-- dropping it here would crash them. Migration 028 drops the column and the
-- legacy increment_campaign_sent RPC once all instances are on new code.
-- New code paths write only to chargeable_sent_count / non_chargeable_sent_count.

-- 8. Supporting indexes
CREATE INDEX IF NOT EXISTS idx_restaurants_welcome_campaign
  ON restaurants(welcome_campaign_id);

-- Partial index: fast path for "exclude non-chargeable coupons" billing query
CREATE INDEX IF NOT EXISTS idx_coupons_is_chargeable
  ON coupons(is_chargeable)
  WHERE is_chargeable = false;

-- 9. Atomic counter RPCs — two split-counter variants. Live at the DB so
-- concurrent Promise.allSettled batches in execute-campaign.ts don't lose
-- increments under contention. The legacy increment_campaign_sent(uuid)
-- from migration 005 stays in place; migration 028 drops it.
CREATE OR REPLACE FUNCTION public.increment_chargeable_sent(p_campaign_id uuid)
RETURNS void AS $$
  UPDATE campaigns
    SET chargeable_sent_count = chargeable_sent_count + 1
    WHERE id = p_campaign_id;
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION public.increment_non_chargeable_sent(p_campaign_id uuid)
RETURNS void AS $$
  UPDATE campaigns
    SET non_chargeable_sent_count = non_chargeable_sent_count + 1
    WHERE id = p_campaign_id;
$$ LANGUAGE sql;

-- 10. Atomic welcome-campaign remap. Called by
-- updateOnboardingSettingsForTenant so that a mid-sequence failure can't
-- leave restaurants.welcome_campaign_id and campaigns.is_chargeable
-- inconsistent (e.g. new mapping persisted but old campaign still flagged
-- non-chargeable, leaking billing).
CREATE OR REPLACE FUNCTION public.remap_welcome_campaign(
  p_restaurant_id uuid,
  p_previous_campaign_id uuid,
  p_next_campaign_id uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE restaurants SET welcome_campaign_id = p_next_campaign_id WHERE id = p_restaurant_id;
  IF p_previous_campaign_id IS NOT NULL THEN
    UPDATE campaigns SET is_chargeable = true WHERE id = p_previous_campaign_id;
  END IF;
  IF p_next_campaign_id IS NOT NULL THEN
    UPDATE campaigns SET is_chargeable = false WHERE id = p_next_campaign_id;
  END IF;
END;
$$;

COMMIT;
