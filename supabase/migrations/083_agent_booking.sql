-- BOOK-003: bookings made by personal agents (PAP 1.0 / poppy.json).
--
-- An agent books through a signed-out public API; the booking stays
-- 'unverified' (invisible to staff, never messaged) until a WhatsApp text
-- carrying its confirm code arrives FROM the booking phone. Promotion is one
-- conditional UPDATE unverified -> pending. Unverified rows expire 30 minutes
-- after creation and the booking-retention job deletes them after one hour.
-- Plan: .claude-workspace/plans/2026-11-19-agent-booking-poppy.md;
-- threats: threats/2026-11-19-agent-booking-poppy.md (R31-R46).

-- ---------------------------------------------------------------------------
-- 1. Status and source vocabulary.
ALTER TABLE booking_requests DROP CONSTRAINT IF EXISTS booking_requests_status_check;
ALTER TABLE booking_requests
  ADD CONSTRAINT booking_requests_status_check
  CHECK (status IN ('unverified', 'pending', 'confirmed', 'declined'));

ALTER TABLE booking_requests DROP CONSTRAINT IF EXISTS booking_requests_source_check;
ALTER TABLE booking_requests
  ADD CONSTRAINT booking_requests_source_check
  CHECK (source IN ('chat', 'campaign', 'agent'));

-- An undecided booking (unverified or pending) has no decided_at; a decided
-- one always has it.
ALTER TABLE booking_requests DROP CONSTRAINT booking_requests_decision_consistent;
ALTER TABLE booking_requests
  ADD CONSTRAINT booking_requests_decision_consistent
  CHECK ((status IN ('unverified', 'pending')) = (decided_at IS NULL));

-- ---------------------------------------------------------------------------
-- 2. Phone proof and agent API columns (R31, R32, R35, R36, R46).
--
-- confirm_code: 6 chars from 23456789ABCDEFGHJKLMNPQRSTUVWXYZ, cleared when
-- the booking is promoted. status_token_hash: SHA-256 hex of the status token
-- the agent holds; the token itself is never stored.
-- One statement per column (the schema-contract parser reads each ADD COLUMN).
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS confirm_code TEXT
  CHECK (confirm_code IS NULL OR confirm_code ~ '^[2-9A-HJ-NP-Z]{6}$');
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS verify_expires_at TIMESTAMPTZ;
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS verified_wamid TEXT;
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS status_token_hash TEXT
  CHECK (status_token_hash IS NULL OR status_token_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS idempotency_key TEXT
  CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 1 AND 255);

-- An unverified booking always carries its code and its expiry.
ALTER TABLE booking_requests
  ADD CONSTRAINT booking_requests_unverified_has_code
  CHECK (status <> 'unverified' OR (confirm_code IS NOT NULL AND verify_expires_at IS NOT NULL));

-- R46: one booking per Idempotency-Key per restaurant.
CREATE UNIQUE INDEX booking_requests_restaurant_idempotency_key_idx
  ON booking_requests (restaurant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- R31: a code is unique among the restaurant's unverified bookings.
CREATE UNIQUE INDEX booking_requests_restaurant_confirm_code_idx
  ON booking_requests (restaurant_id, confirm_code)
  WHERE status = 'unverified';

-- The webhook's code lookup (restaurant, sender phone, unverified) and the
-- live-unverified caps (R39) use booking_requests_restaurant_phone_status_idx
-- from 082 (restaurant_id, phone, status). Per-restaurant cap and the purge:
CREATE INDEX booking_requests_unverified_created_idx
  ON booking_requests (restaurant_id, created_at)
  WHERE status = 'unverified';

-- ---------------------------------------------------------------------------
-- 3. Agent booking id lookup (R33, R43).
--
-- booking_config.agentBooking.publicId selects the tenant for the public API.
-- Unique so two restaurants can never share one; the expression matches the
-- PostgREST filter booking_config->agentBooking->>publicId.
CREATE UNIQUE INDEX restaurants_agent_booking_public_id_idx
  ON restaurants ((booking_config -> 'agentBooking' ->> 'publicId'))
  WHERE booking_config -> 'agentBooking' ->> 'publicId' IS NOT NULL;
