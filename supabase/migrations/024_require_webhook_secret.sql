-- Ensure every POS integration has a webhook secret (required for authentication)
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
UPDATE pos_integrations SET webhook_secret = encode(extensions.gen_random_bytes(32), 'hex') WHERE webhook_secret IS NULL;
ALTER TABLE pos_integrations ALTER COLUMN webhook_secret SET NOT NULL;
