-- Layout verification templates
CREATE TABLE IF NOT EXISTS receipt_layout_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  template_json JSONB NOT NULL,
  sample_image_urls TEXT[] NOT NULL,
  sample_count INTEGER NOT NULL,
  threshold NUMERIC(3, 2) NOT NULL DEFAULT 0.65,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_layout_templates_restaurant
  ON receipt_layout_templates(restaurant_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_layout_templates_active
  ON receipt_layout_templates(restaurant_id)
  WHERE status = 'active';

-- Add layout verification columns to receipts
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS layout_score NUMERIC(4, 3);
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS layout_flags JSONB;

-- Add 'flagged' to receipts status constraint
ALTER TABLE receipts DROP CONSTRAINT IF EXISTS receipts_status_check;
ALTER TABLE receipts ADD CONSTRAINT receipts_status_check
  CHECK (status IN ('processing', 'pending_confirmation', 'confirmed', 'rejected', 'flagged'));
