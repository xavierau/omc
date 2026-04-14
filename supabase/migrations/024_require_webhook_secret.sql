-- Ensure every POS integration has a webhook secret (required for authentication)
UPDATE pos_integrations SET webhook_secret = encode(gen_random_bytes(32), 'hex') WHERE webhook_secret IS NULL;
ALTER TABLE pos_integrations ALTER COLUMN webhook_secret SET NOT NULL;
