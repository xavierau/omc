-- REPLY-003: per-restaurant fallback-reply configuration.
--
-- Lets a tenant (a) override the three no-keyword fallback messages — the
-- "didn't understand" reply, the HELP command list, and the Welcome/Join
-- invite — in EN + ZH, and (b) toggle the POINTS / REWARDS / REDEEM / CARD
-- functions on or off. A disabled function is hidden from the fallback menu
-- and the HELP list, and its keyword returns the "didn't understand" reply.
--
-- Stored as a single JSONB blob (cohesive, growable settings group) rather than
-- ~10 typed columns. Shape (only non-default keys need storing; missing = default):
--   { "features": { "points": true, "rewards": true, "redeem": true, "card": true },
--     "text": { "unknown": {"en": "...", "zh": "..."},
--               "help":    {"en": "...", "zh": "..."},
--               "join":    {"en": "...", "zh": "..."} } }
--
-- DEFAULT '{}' => every existing row reads as all-features-ON + stock copy, so
-- there is ZERO behavior change on deploy. No CHECK (the JSON shape is validated
-- at the API boundary, mirroring how redirect_number is validated). No RLS change:
-- the new column inherits the existing row-level restaurants policies.

ALTER TABLE restaurants
  ADD COLUMN reply_config JSONB NOT NULL DEFAULT '{}'::jsonb;
