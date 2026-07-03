-- 053: DB-level idempotency for campaign-broadcast claim (CAMP-001)
--
-- The claim-button flow mints one `promo` coupon per (campaign, member) on the
-- first tap (application/claim-campaign-coupon.ts). A concurrent double-tap
-- could otherwise insert two rows: both taps read no existing coupon, both
-- insert. This partial UNIQUE index makes the losing insert fail with SQLSTATE
-- 23505, which claimCampaignCoupon catches and converts into an idempotent
-- re-fetch (same coupon, QR resent).
--
-- Partial so it constrains ONLY campaign-broadcast promo coupons and never the
-- welcome / reward / shared coupons that legitimately share a member with a
-- null campaign_id.
--
-- DEPLOY GATE — a non-CONCURRENTLY unique index FAILS (aborting the deploy) if
-- any pre-existing (campaign_id, member_id) promo duplicates exist. Duplicates
-- are structurally unlikely (a campaign executes once per active→sending
-- transition, one coupon per recipient) but a campaign re-executed after a
-- partial failure could have minted some members twice. BEFORE applying, run:
--
--   SELECT campaign_id, member_id, count(*) FROM coupons
--   WHERE type = 'promo' AND campaign_id IS NOT NULL AND member_id IS NOT NULL
--   GROUP BY 1, 2 HAVING count(*) > 1;
--
-- If it returns rows, dedupe (keep the earliest active coupon per pair) before
-- deploying — do NOT delete a coupon a customer may already hold without review.
-- A clean deploy aborts rather than corrupting data if this is skipped.
--
-- No RLS change (coupons already carries its tenant policy from the earlier
-- coupon migrations). IF NOT EXISTS keeps the migration re-runnable.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_coupon_campaign_member
  ON coupons (campaign_id, member_id)
  WHERE type = 'promo' AND campaign_id IS NOT NULL AND member_id IS NOT NULL;
