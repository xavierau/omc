-- 090_coupons_welcome_offer.sql
-- WONB-020 r4 H2 (PR #212 third review): record welcome provenance on the
-- coupon itself.
--
-- The WhatsApp welcome claim (canClaimWelcome -> hasWelcomeCoupon ->
-- findLatestWelcomeOfferCode, src/infrastructure/supabase/repositories/
-- coupon-repository.ts) treats a member who already holds a welcome offer as
-- not claimable. A welcome-campaign mint is a `promo` coupon, and until now
-- the only way to tell it was a welcome offer was its campaign's CURRENT type.
-- Deleting the campaign (coupons.campaign_id -> NULL) or retyping it made the
-- coupon look like an ordinary promo, so the member could claim a second
-- welcome coupon. From now on every welcome mint writes welcome_offer = true
-- (createWelcomeCoupon, and createCampaignCoupon with welcomeOffer: true from
-- onboardNewMember and registerMemberWeb), and the lookup matches
-- type = 'welcome' OR welcome_offer = true.
--
-- Backfill: every existing type = 'welcome' coupon, and every coupon of a
-- campaign that is a welcome campaign of the same restaurant today. Coupons
-- whose welcome campaign was already deleted or retyped can't be recovered;
-- for those members the join event still blocks a second claim.
--
-- DEPLOY ORDER: apply BEFORE the code that writes the column. deploy.sh runs
-- `supabase db push` before it restarts the daemons, so a normal release
-- does this. ADD COLUMN with a constant default is metadata-only (PG 11+);
-- the UPDATE touches only welcome coupons.
-- Idempotent: safe to run twice (IF NOT EXISTS; the UPDATE skips rows
-- already true).

ALTER TABLE coupons
  ADD COLUMN IF NOT EXISTS welcome_offer boolean NOT NULL DEFAULT false;

UPDATE coupons c
SET welcome_offer = true
WHERE c.welcome_offer = false
  AND (
    c.type = 'welcome'
    OR EXISTS (
      SELECT 1
      FROM campaigns k
      WHERE k.id = c.campaign_id
        AND k.restaurant_id = c.restaurant_id
        AND k.type = 'welcome'
    )
  );
