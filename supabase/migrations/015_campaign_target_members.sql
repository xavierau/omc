-- Add target_audience column to campaigns
ALTER TABLE campaigns
  ADD COLUMN target_audience TEXT NOT NULL DEFAULT 'all'
  CHECK (target_audience IN ('all', 'selected'));

-- Create campaign_members join table
CREATE TABLE campaign_members (
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  member_id   UUID NOT NULL REFERENCES members(id)   ON DELETE CASCADE,
  PRIMARY KEY (campaign_id, member_id)
);

-- Index for reverse lookups (member -> campaigns)
CREATE INDEX idx_campaign_members_member_id ON campaign_members(member_id);
