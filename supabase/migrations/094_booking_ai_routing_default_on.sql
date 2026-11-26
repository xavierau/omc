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
-- Rollback (re-disables the classifier for the tenants this flipped; this
-- migration does not record them, so they are named here). On prod it flips:
--   kushiro  id: 96676002-4ba4-46cc-966c-061adc5d26f1
--   bicho    id: see release runbook GET-before
-- The rollback bumps rev with the same CASE, so a writer holding the
-- post-094 blob re-reads instead of writing true back:
--   UPDATE public.restaurants
--   SET booking_config = booking_config || jsonb_build_object(
--     'aiRoutingEnabled', false,
--     'rev', CASE
--       WHEN jsonb_typeof(booking_config->'rev') = 'number'
--         AND (booking_config->'rev')::numeric = trunc((booking_config->'rev')::numeric)
--       THEN to_jsonb(trunc((booking_config->'rev')::numeric) + 1)
--       ELSE '1'::jsonb
--     END
--   )
--   WHERE id IN ('96676002-4ba4-46cc-966c-061adc5d26f1', '<bicho id>');

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
