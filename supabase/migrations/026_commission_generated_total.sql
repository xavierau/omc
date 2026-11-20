-- 026_commission_generated_total.sql
-- Make referrer_commissions.total_commission a STORED GENERATED column so
-- it is always the exact sum of broadcast_commission + redemption_commission.
-- This enforces the invariant at the DB level — application code can no longer
-- drift from the split columns.

BEGIN;

-- 1. Drop the paid-record trigger temporarily so we can restructure the column
ALTER TABLE referrer_commissions DISABLE TRIGGER guard_paid_commissions;

-- 2. Drop the default + the column so we can re-add as GENERATED
ALTER TABLE referrer_commissions ALTER COLUMN total_commission DROP DEFAULT;
ALTER TABLE referrer_commissions DROP COLUMN total_commission;

-- 3. Re-add as GENERATED (always derived)
ALTER TABLE referrer_commissions
  ADD COLUMN total_commission NUMERIC(12,4) NOT NULL
    GENERATED ALWAYS AS (broadcast_commission + redemption_commission) STORED;

-- 4. Re-enable trigger
ALTER TABLE referrer_commissions ENABLE TRIGGER guard_paid_commissions;

COMMIT;
