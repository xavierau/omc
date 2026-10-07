-- POS Integration tables
-- Supports per-tenant POS provider configuration and transaction tracking

-- pos_integrations: per-tenant POS provider config
CREATE TABLE pos_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  provider TEXT NOT NULL DEFAULT 'generic',
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  webhook_secret TEXT,
  field_mapping JSONB,
  credentials JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pos_integrations_restaurant
  ON pos_integrations(restaurant_id);

-- pos_transactions: individual POS transaction records
CREATE TABLE pos_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pos_integration_id UUID NOT NULL REFERENCES pos_integrations(id),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  member_id UUID REFERENCES members(id),
  external_transaction_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('sale', 'refund')),
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'HKD',
  customer_phone TEXT,
  points_awarded INTEGER NOT NULL DEFAULT 0,
  raw_payload JSONB NOT NULL DEFAULT '{}',
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pos_integration_id, external_transaction_id)
);

CREATE INDEX idx_pos_transactions_restaurant
  ON pos_transactions(restaurant_id);
CREATE INDEX idx_pos_transactions_member
  ON pos_transactions(member_id);
CREATE INDEX idx_pos_transactions_processed
  ON pos_transactions(restaurant_id, processed_at DESC);

-- Extend events type CHECK to include POS event types
-- The original inline CHECK is auto-named events_type_check by Postgres
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_type_check;
ALTER TABLE events ADD CONSTRAINT events_type_check
  CHECK (type IN (
    'join', 'redeem', 'receipt', 'campaign', 'points',
    'unsubscribe', 'reward_redeem',
    'pos_transaction', 'pos_refund', 'pos_customer_link',
    'integration_error'
  ));

-- RLS
ALTER TABLE pos_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY pos_integrations_service
  ON pos_integrations FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY pos_transactions_service
  ON pos_transactions FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
