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

-- 5. Update trigger to explicitly protect new columns on paid records
-- The existing trigger blocks ALL updates when status = 'paid'.
-- Re-creating with CREATE OR REPLACE to document coverage of new columns.
CREATE OR REPLACE FUNCTION prevent_paid_commission_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'paid' THEN
    RAISE EXCEPTION 'Cannot modify a paid commission record (id: %)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger already exists on referrer_commissions from migration 019.
-- CREATE OR REPLACE FUNCTION above is sufficient; no need to recreate the trigger.

COMMIT;
