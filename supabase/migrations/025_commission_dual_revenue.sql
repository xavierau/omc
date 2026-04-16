-- 025_commission_dual_revenue.sql
-- Extend referrer + commission schema for dual revenue streams:
-- broadcast messages AND coupon redemptions.

BEGIN;

-- 1. referrers: add per-redemption commission rate
ALTER TABLE referrers
  ADD COLUMN IF NOT EXISTS commission_per_redemption_hkd NUMERIC(10,4) NOT NULL DEFAULT 0.10;

ALTER TABLE referrers
  DROP CONSTRAINT IF EXISTS referrers_commission_per_redemption_hkd_check;

ALTER TABLE referrers
  ADD CONSTRAINT referrers_commission_per_redemption_hkd_check
  CHECK (commission_per_redemption_hkd >= 0 AND commission_per_redemption_hkd <= 1);

-- 2. referrer_commissions: add redemption tracking and split commission columns
ALTER TABLE referrer_commissions
  ADD COLUMN IF NOT EXISTS redemptions_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_per_redemption NUMERIC(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS broadcast_commission NUMERIC(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS redemption_commission NUMERIC(12,4) NOT NULL DEFAULT 0;

-- 3. Backfill existing rows: broadcast_commission = total_commission, redemption stays 0
--    Temporarily disable the paid-record guard so we can backfill paid rows too.
ALTER TABLE referrer_commissions DISABLE TRIGGER guard_paid_commissions;

UPDATE referrer_commissions
SET broadcast_commission = total_commission,
    redemption_commission = 0
WHERE broadcast_commission = 0 AND total_commission > 0;

ALTER TABLE referrer_commissions ENABLE TRIGGER guard_paid_commissions;

-- 4. Index on coupon_redemptions(redeemed_at)
-- Already exists from migration 011 (idx_coupon_redemptions_redeemed_at). Skipped.

-- 5. Paid-record protection: no schema change needed.
-- Note: The prevent_paid_commission_update trigger from migration 019
-- continues to protect all columns on referrer_commissions — including the
-- 4 new columns added above — because it blocks ANY UPDATE when status='paid'.

COMMIT;
