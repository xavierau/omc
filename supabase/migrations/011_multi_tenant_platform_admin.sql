-- A. user_tenants table
CREATE TABLE user_tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'staff')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, restaurant_id)
);
CREATE INDEX idx_user_tenants_user_id ON user_tenants(user_id);
CREATE INDEX idx_user_tenants_restaurant_id ON user_tenants(restaurant_id);

-- B. platform_admins table
CREATE TABLE platform_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- C. Fix coupon unique constraint: UNIQUE(code) -> UNIQUE(restaurant_id, code)
ALTER TABLE coupons DROP CONSTRAINT coupons_code_key;
CREATE UNIQUE INDEX idx_coupons_restaurant_code ON coupons(restaurant_id, code);

-- D. Add status and trial_expires_at to restaurants
ALTER TABLE restaurants ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'inactive', 'trial'));
ALTER TABLE restaurants ADD COLUMN trial_expires_at TIMESTAMPTZ;
ALTER TABLE restaurants ADD CONSTRAINT trial_requires_expiry
  CHECK (status != 'trial' OR trial_expires_at IS NOT NULL);

-- E. Unique index on kapso_phone_number_id
CREATE UNIQUE INDEX idx_restaurants_kapso_phone
  ON restaurants(kapso_phone_number_id)
  WHERE kapso_phone_number_id IS NOT NULL;

-- F. RLS policies
-- Enable RLS on ALL tables
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_layout_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;

-- Helper functions
CREATE OR REPLACE FUNCTION is_platform_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM platform_admins WHERE user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION user_restaurant_ids()
RETURNS SETOF UUID AS $$
BEGIN
  RETURN QUERY
    SELECT restaurant_id FROM user_tenants WHERE user_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- RLS policies for platform_admins
CREATE POLICY platform_admins_select ON platform_admins
  FOR SELECT USING (user_id = auth.uid() OR is_platform_admin());

-- RLS policies for user_tenants
CREATE POLICY user_tenants_select ON user_tenants
  FOR SELECT USING (user_id = auth.uid() OR is_platform_admin());
CREATE POLICY user_tenants_insert ON user_tenants
  FOR INSERT WITH CHECK (is_platform_admin());
CREATE POLICY user_tenants_delete ON user_tenants
  FOR DELETE USING (is_platform_admin());

-- RLS policies for restaurants
CREATE POLICY restaurants_select ON restaurants
  FOR SELECT USING (
    id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );
CREATE POLICY restaurants_insert ON restaurants
  FOR INSERT WITH CHECK (is_platform_admin());
CREATE POLICY restaurants_update ON restaurants
  FOR UPDATE USING (
    id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );

-- members
CREATE POLICY members_select ON members
  FOR SELECT USING (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );
CREATE POLICY members_insert ON members
  FOR INSERT WITH CHECK (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );
CREATE POLICY members_update ON members
  FOR UPDATE USING (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );

-- coupons
CREATE POLICY coupons_select ON coupons
  FOR SELECT USING (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );
CREATE POLICY coupons_insert ON coupons
  FOR INSERT WITH CHECK (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );
CREATE POLICY coupons_update ON coupons
  FOR UPDATE USING (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );

-- coupon_redemptions
CREATE POLICY coupon_redemptions_select ON coupon_redemptions
  FOR SELECT USING (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );

-- receipts
CREATE POLICY receipts_select ON receipts
  FOR SELECT USING (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );
CREATE POLICY receipts_insert ON receipts
  FOR INSERT WITH CHECK (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );
CREATE POLICY receipts_update ON receipts
  FOR UPDATE USING (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );

-- campaigns
CREATE POLICY campaigns_select ON campaigns
  FOR SELECT USING (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );
CREATE POLICY campaigns_insert ON campaigns
  FOR INSERT WITH CHECK (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );
CREATE POLICY campaigns_update ON campaigns
  FOR UPDATE USING (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );

-- events
CREATE POLICY events_select ON events
  FOR SELECT USING (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );
CREATE POLICY events_insert ON events
  FOR INSERT WITH CHECK (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );

-- whatsapp_templates
CREATE POLICY wa_templates_select ON whatsapp_templates
  FOR SELECT USING (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );
CREATE POLICY wa_templates_insert ON whatsapp_templates
  FOR INSERT WITH CHECK (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );
CREATE POLICY wa_templates_update ON whatsapp_templates
  FOR UPDATE USING (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );

-- rewards
CREATE POLICY rewards_select ON rewards
  FOR SELECT USING (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );
CREATE POLICY rewards_insert ON rewards
  FOR INSERT WITH CHECK (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );
CREATE POLICY rewards_update ON rewards
  FOR UPDATE USING (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );

-- receipt_layout_templates
CREATE POLICY layout_templates_select ON receipt_layout_templates
  FOR SELECT USING (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );
CREATE POLICY layout_templates_insert ON receipt_layout_templates
  FOR INSERT WITH CHECK (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );

-- G. Analytics indexes
CREATE INDEX idx_members_joined_at ON members(joined_at);
CREATE INDEX idx_receipts_created_at ON receipts(created_at);
CREATE INDEX idx_coupons_created_at ON coupons(created_at);
CREATE INDEX idx_coupon_redemptions_redeemed_at
  ON coupon_redemptions(redeemed_at);
