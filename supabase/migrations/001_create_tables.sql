-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- restaurants
CREATE TABLE restaurants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  whatsapp_number TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- members
CREATE TABLE members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  name TEXT,
  points_balance INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'unsubscribed')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_visit_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX idx_members_restaurant_phone ON members(restaurant_id, phone);
CREATE INDEX idx_members_restaurant_id ON members(restaurant_id);

-- coupons
CREATE TABLE coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('welcome', 'promo', 'reward')),
  code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'redeemed', 'expired')),
  member_id UUID REFERENCES members(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ,
  redeemed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_coupons_member_id ON coupons(member_id);
CREATE INDEX idx_coupons_restaurant_id ON coupons(restaurant_id);

-- receipts
CREATE TABLE receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  image_url TEXT,
  total_amount NUMERIC(10, 2),
  items_json JSONB,
  points_awarded INTEGER DEFAULT 0,
  confidence NUMERIC(3, 2),
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'pending_confirmation', 'confirmed', 'rejected')),
  pending_amount NUMERIC(10, 2),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_receipts_member_id ON receipts(member_id);
CREATE INDEX idx_receipts_restaurant_id ON receipts(restaurant_id);

-- campaigns
CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('welcome', 'winback', 'birthday', 'promo')),
  template TEXT NOT NULL,
  schedule JSONB,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'completed')),
  sent_count INTEGER NOT NULL DEFAULT 0,
  redeemed_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_campaigns_restaurant_id ON campaigns(restaurant_id);

-- events
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  member_id UUID REFERENCES members(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('join', 'redeem', 'receipt', 'campaign', 'points', 'unsubscribe')),
  data_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_events_restaurant_id ON events(restaurant_id);
CREATE INDEX idx_events_created_at ON events(created_at DESC);
CREATE INDEX idx_events_type ON events(type);

-- processed_webhooks (idempotency)
CREATE TABLE processed_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_processed_webhooks_key ON processed_webhooks(idempotency_key);
