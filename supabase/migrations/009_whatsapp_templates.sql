-- WhatsApp templates table
CREATE TABLE whatsapp_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  meta_template_id TEXT,
  name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  category TEXT NOT NULL CHECK (category IN ('MARKETING', 'UTILITY')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'paused', 'disabled', 'deleted')),
  components JSONB NOT NULL DEFAULT '[]',
  parameter_format TEXT NOT NULL DEFAULT 'NAMED',
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint: one template per name+language per restaurant (excluding deleted)
CREATE UNIQUE INDEX idx_wa_templates_restaurant_name_lang
  ON whatsapp_templates(restaurant_id, name, language)
  WHERE status != 'deleted';

CREATE INDEX idx_wa_templates_restaurant_id ON whatsapp_templates(restaurant_id);
CREATE INDEX idx_wa_templates_status ON whatsapp_templates(status);

-- Link campaigns to whatsapp templates
ALTER TABLE campaigns ADD COLUMN whatsapp_template_id UUID
  REFERENCES whatsapp_templates(id) ON DELETE SET NULL;

-- Add Meta Business Account ID to restaurants
ALTER TABLE restaurants ADD COLUMN meta_business_account_id TEXT;

-- Trigger function to auto-update updated_at column
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_whatsapp_templates_updated
  BEFORE UPDATE ON whatsapp_templates
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
