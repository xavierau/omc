-- Add new columns to campaigns
ALTER TABLE campaigns ADD COLUMN name TEXT;
ALTER TABLE campaigns ADD COLUMN coupon_config JSONB;
ALTER TABLE campaigns ADD COLUMN scheduled_at TIMESTAMPTZ;

-- Add campaign_id to coupons
ALTER TABLE coupons ADD COLUMN campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL;

-- Indexes
CREATE INDEX idx_coupons_campaign_id ON coupons(campaign_id);
CREATE INDEX idx_campaigns_scheduled ON campaigns(scheduled_at)
  WHERE status = 'active' AND scheduled_at IS NOT NULL;

-- Atomic increment for campaign sent_count
CREATE OR REPLACE FUNCTION increment_campaign_sent(campaign_id_param UUID)
RETURNS void AS $$
BEGIN
  UPDATE campaigns SET sent_count = sent_count + 1 WHERE id = campaign_id_param;
END;
$$ LANGUAGE plpgsql;

-- Atomic increment for campaign redeemed_count
CREATE OR REPLACE FUNCTION increment_campaign_redeemed(campaign_id_param UUID)
RETURNS void AS $$
BEGIN
  UPDATE campaigns SET redeemed_count = redeemed_count + 1 WHERE id = campaign_id_param;
END;
$$ LANGUAGE plpgsql;
