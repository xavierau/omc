-- Add Meta phone number ID to restaurants for per-restaurant WhatsApp sending
ALTER TABLE restaurants
  ADD COLUMN kapso_phone_number_id TEXT;
