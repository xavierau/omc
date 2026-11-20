-- REPLY-008: one-off capability tokens for the web contact form.
--
-- The web form is the fallback used while WhatsApp Flows cannot be published
-- (issue #78 — Meta integrity gate). Unlike the Flow path, where the webhook's
-- own tenant resolution and `message.from` are authoritative and the flow
-- token is merely a defensive cross-tenant check, NOTHING vouches for who is
-- POSTing to a public web form. This token IS the identity proof, so it is
-- stored server-side rather than encoded into the URL: the customer's phone
-- number never appears in a query string, browser history, or referrer.
--
-- No HMAC/signature: `token` is 256 bits of CSPRNG, which is already an
-- unguessable capability, and this table is the source of truth for validity.
-- Signing would add a secret to provision and rotate without adding security.
--
-- Single-use is enforced by a conditional UPDATE on `consumed_at IS NULL`
-- (same idiom as `updateContactFlowIdIfEmpty`), which makes a double-submit
-- race resolve to exactly one accepted submission and one email.
CREATE TABLE contact_form_tokens (
  token       TEXT PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  -- E.164 with leading '+', matching `PhoneNumber.create(...).value` and
  -- `restaurants.whatsapp_number`. Captured at mint time from the webhook's
  -- authenticated sender; the form can never override it.
  phone       TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Supports the per-tenant issuance lookups used for throttling and support
-- ("was a link ever issued to this number?"), which is otherwise unanswerable:
-- contact submissions are emailed and never persisted.
CREATE INDEX contact_form_tokens_restaurant_created_idx
  ON contact_form_tokens (restaurant_id, created_at DESC);

-- Housekeeping for the sweeper: expired-and-unconsumed rows are dead weight.
CREATE INDEX contact_form_tokens_expires_idx ON contact_form_tokens (expires_at);

-- Service-role only. Every read and write goes through the server (webhook
-- mint, server-component page load, POST consume); no browser ever queries
-- this table directly, so RLS is enabled with no permissive policy at all.
ALTER TABLE contact_form_tokens ENABLE ROW LEVEL SECURITY;
