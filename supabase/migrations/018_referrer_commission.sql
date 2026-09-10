-- 1. Referrers table
CREATE TABLE referrers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  commission_per_message_hkd NUMERIC(10,4) NOT NULL DEFAULT 0.05, -- mirrors DEFAULT_COMMISSION_HKD in commission-rate.ts
  status VARCHAR(10) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('active', 'inactive')),
  CHECK (commission_per_message_hkd >= 0 AND commission_per_message_hkd <= 1),
  UNIQUE(contact_email)
);

-- 2. Auto-update trigger for updated_at (reuses set_updated_at() from 009)
CREATE TRIGGER set_referrers_updated_at
  BEFORE UPDATE ON referrers
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- 3. Link restaurants to referrers
ALTER TABLE restaurants ADD COLUMN referrer_id UUID REFERENCES referrers(id);
CREATE INDEX idx_restaurants_referrer_id ON restaurants(referrer_id);

-- 4. Referrer commissions table
CREATE TABLE referrer_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES referrers(id),
  month VARCHAR(7) NOT NULL,
  tenant_id UUID NOT NULL REFERENCES restaurants(id),
  tenant_name TEXT NOT NULL, -- latest name, updated on each upsert
  messages_sent INTEGER NOT NULL DEFAULT 0,
  commission_per_message NUMERIC(10,4) NOT NULL,
  total_commission NUMERIC(12,4) NOT NULL DEFAULT 0,
  status VARCHAR(10) NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('pending', 'paid')),
  UNIQUE(referrer_id, month, tenant_id)
);

CREATE TRIGGER set_referrer_commissions_updated_at
  BEFORE UPDATE ON referrer_commissions
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- 5. RLS: platform admin full CRUD
ALTER TABLE referrers ENABLE ROW LEVEL SECURITY;

CREATE POLICY referrers_admin ON referrers FOR ALL USING (
  EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid())
);

ALTER TABLE referrer_commissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY referrer_commissions_admin ON referrer_commissions FOR ALL USING (
  EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid())
);

-- 6. Indexes
CREATE INDEX idx_referrer_commissions_referrer_id ON referrer_commissions(referrer_id);
CREATE INDEX idx_referrer_commissions_month ON referrer_commissions(month);
