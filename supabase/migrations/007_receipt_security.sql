ALTER TABLE receipts ADD COLUMN IF NOT EXISTS receipt_number TEXT;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS merchant_name TEXT;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS tamper_flags JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_restaurant_receipt_number
  ON receipts(restaurant_id, receipt_number)
  WHERE receipt_number IS NOT NULL AND receipt_number != '';
