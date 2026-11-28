-- Add new columns to coupons
ALTER TABLE coupons ADD COLUMN discount_type TEXT CHECK (discount_type IN ('percentage', 'fixed_amount'));
ALTER TABLE coupons ADD COLUMN discount_value NUMERIC(10,2);
ALTER TABLE coupons ADD COLUMN max_uses INTEGER;
ALTER TABLE coupons ADD COLUMN current_uses INTEGER NOT NULL DEFAULT 0;
ALTER TABLE coupons ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE coupons ADD COLUMN description TEXT;

-- Expand type CHECK to include 'shared'
ALTER TABLE coupons DROP CONSTRAINT coupons_type_check;
ALTER TABLE coupons ADD CONSTRAINT coupons_type_check CHECK (type IN ('welcome', 'promo', 'reward', 'shared'));

-- Backfill existing data
UPDATE coupons SET max_uses = 1;
UPDATE coupons SET current_uses = 1 WHERE status = 'redeemed';
UPDATE coupons SET current_uses = 0 WHERE status != 'redeemed';

-- Create coupon_redemptions table
CREATE TABLE coupon_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_coupon_redemptions_coupon_member ON coupon_redemptions(coupon_id, member_id);
CREATE INDEX idx_coupon_redemptions_coupon_id ON coupon_redemptions(coupon_id);
CREATE INDEX idx_coupon_redemptions_member_id ON coupon_redemptions(member_id);

-- Atomic increment function for current_uses
CREATE OR REPLACE FUNCTION increment_coupon_uses(coupon_id_param UUID)
RETURNS void AS $$
BEGIN
  UPDATE coupons SET current_uses = current_uses + 1 WHERE id = coupon_id_param;
END;
$$ LANGUAGE plpgsql;

-- Atomic decrement function for current_uses (rollback on race condition)
CREATE OR REPLACE FUNCTION decrement_coupon_uses(coupon_id_param UUID)
RETURNS void AS $$
BEGIN
  UPDATE coupons SET current_uses = GREATEST(current_uses - 1, 0) WHERE id = coupon_id_param;
END;
$$ LANGUAGE plpgsql;

-- Backfill redemptions from existing redeemed coupons
INSERT INTO coupon_redemptions (coupon_id, member_id, restaurant_id, redeemed_at)
SELECT id, member_id, restaurant_id, COALESCE(redeemed_at, NOW())
FROM coupons
WHERE status = 'redeemed' AND member_id IS NOT NULL;
