-- BOOK-012 (owner ruling 2026-11-26): the BOOK-001 booking-intent classifier is
-- on by default. booking_config.aiRoutingEnabled became an opt-out in the app
-- (booking-config.ts: only an explicit false turns it off; a missing key is on),
-- and every stored false is flipped to true here ("flip all existing").
--
-- Rows without the key are left as they are: the parser default covers them.
-- Only aiRoutingEnabled and rev change; every other key is untouched (jsonb ||
-- replaces just the two top-level keys).
--
-- rev is bumped because every booking_config writer is a compare-and-swap on it
-- (booking-config-repository.ts changeBookingConfig): a writer that read the
-- old blob before this ran would otherwise pass its rev guard and write
-- aiRoutingEnabled false back. With rev moved, it re-reads and re-applies.
-- The bump mirrors the app's rule: an integer rev + 1, anything else 1.
--
-- Idempotent: a second run matches no row. Mode-off rows are flipped too;
-- harmless, since mode off never classifies.
--
-- Rollback (re-disables the classifier for every tenant that had false; the
-- owner would have to name them, since this migration does not record which):
--   UPDATE public.restaurants
--   SET booking_config = booking_config || '{"aiRoutingEnabled": false}'::jsonb
--   WHERE id IN (<the tenants to turn off>);

UPDATE public.restaurants
SET booking_config = booking_config || jsonb_build_object(
  'aiRoutingEnabled', true,
  'rev', CASE
    WHEN jsonb_typeof(booking_config->'rev') = 'number'
      AND (booking_config->'rev')::numeric = trunc((booking_config->'rev')::numeric)
    THEN to_jsonb(trunc((booking_config->'rev')::numeric) + 1)
    ELSE '1'::jsonb
  END
)
WHERE booking_config->'aiRoutingEnabled' = 'false'::jsonb;
