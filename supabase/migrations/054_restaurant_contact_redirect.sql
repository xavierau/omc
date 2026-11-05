-- REPLY-001: per-restaurant contact-redirect CTA for the fallback reply menu.
-- When an inbound WhatsApp message matches no keyword, tenants can surface a
-- "Contact us" option that opens https://wa.me/<redirect_number> (a tap-to-open
-- deep link — WhatsApp cannot transfer a chat server-side).
--
-- redirect_number is nullable => feature is OFF when NULL (unchanged 3-button
-- fallback). No CHECK constraint here: the E.164 format is validated at the API
-- boundary, mirroring how whatsapp_number is stored freely. No RLS change: the
-- new columns inherit the existing row-level restaurants policies.
-- redirect_label is the tenant-authored button/row caption (DB default 'Contact us').

ALTER TABLE restaurants
  ADD COLUMN redirect_number TEXT,                            -- nullable => feature OFF when NULL
  ADD COLUMN redirect_label  TEXT NOT NULL DEFAULT 'Contact us';
