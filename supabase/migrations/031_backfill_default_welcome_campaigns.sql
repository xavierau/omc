-- 031_backfill_default_welcome_campaigns.sql
-- ONBOARD-009: Seed a default welcome campaign for every tenant that does
-- not already have one mapped.
--
-- Admins who signed up before the welcome-campaign UI existed were left
-- with `restaurants.welcome_campaign_id = NULL`, so the /dashboard/setup
-- picker had nothing to select and the runtime fell back to the hardcoded
-- `onboarding-defaults.ts` copy. This backfill closes the gap so every
-- tenant has an editable welcome campaign row.
--
-- Idempotent: the INSERT ... SELECT is guarded by `welcome_campaign_id
-- IS NULL`, so re-running the migration never creates duplicate welcome
-- campaigns. The templates below are verbatim copies of the double-brace
-- variant of `onboarding-defaults.ts` + `build-default-welcome-campaign.ts`
-- so admins see the same copy whether the row was seeded or the fallback
-- fires at runtime.

BEGIN;

-- 1. Insert one welcome campaign per restaurant that has none mapped.
--    RETURNING rows so step 2 can map them without a second scan.
WITH needs_seed AS (
  SELECT id AS restaurant_id
  FROM restaurants
  WHERE welcome_campaign_id IS NULL
),
inserted AS (
  INSERT INTO campaigns (
    restaurant_id,
    name,
    type,
    template,
    template_en,
    template_zh_hk,
    coupon_config,
    status,
    is_chargeable
  )
  SELECT
    ns.restaurant_id,
    'Default Welcome Campaign',
    'welcome',
    E'歡迎加入我們的會員計劃！\n\n您已獲得歡迎禮物！\n請使用代碼：{{couponCode}}\n\n回覆 POINTS 查詢積分，或傳送收據相片賺取積分。',
    E'Welcome to our loyalty program!\n\nYou''ve received a welcome gift!\nUse code: {{couponCode}}\n\nReply POINTS to check balance, or send a receipt photo to earn points.',
    E'歡迎加入我們的會員計劃！\n\n您已獲得歡迎禮物！\n請使用代碼：{{couponCode}}\n\n回覆 POINTS 查詢積分，或傳送收據相片賺取積分。',
    '{"discountType": "percentage", "discountValue": 10, "expiresInDays": 30}'::jsonb,
    'active',
    false
  FROM needs_seed ns
  RETURNING id AS campaign_id, restaurant_id
)
-- 2. Map each seeded campaign as the restaurant's welcome campaign.
UPDATE restaurants r
  SET welcome_campaign_id = i.campaign_id
  FROM inserted i
  WHERE r.id = i.restaurant_id
    AND r.welcome_campaign_id IS NULL;

-- 3. Defense-in-depth: enforces one active welcome campaign per restaurant
--    (complements the app-layer idempotency guard in seedDefaultWelcomeCampaign).
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_one_active_welcome_per_restaurant
  ON campaigns(restaurant_id)
  WHERE type = 'welcome' AND status = 'active';

COMMIT;
