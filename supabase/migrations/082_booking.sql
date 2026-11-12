-- BOOK-001: restaurant booking (simple booking + booking-intent routing).
--
-- This ONE migration owns all BOOK-001 schema, including what W2 (inbound
-- routing) and W3 (campaign Book now, templates, crons) use, so neither needs
-- another migration. Plan: .claude-workspace/plans/2026-11-12-restaurant-booking.md
-- (Domain Model); threats: threats/2026-11-12-restaurant-booking.md (R1-R21).
--
-- Every new table is service-role only: RLS on, no policies (same posture as
-- 060 contact_form_tokens). Every read and write goes through the server; the
-- dashboard reads bookings through API routes scoped by getTenantContext().

-- ---------------------------------------------------------------------------
-- 1. Per-restaurant booking settings.
--
-- Read by its own getter (booking-config-repository.ts), never through
-- RESTAURANT_COLUMNS, so the webhook hot path is not coupled to this column.
-- NOT NULL DEFAULT backfills every existing row to mode off (spec AC-3);
-- the shape is resolved and defaulted in the domain (booking-config.ts).
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS booking_config JSONB NOT NULL DEFAULT '{"mode":"off"}'::jsonb;

-- Belt and braces for rows written before this migration ran on a partially
-- applied database (the column default already covers a fresh ADD COLUMN).
UPDATE restaurants SET booking_config = '{"mode":"off"}'::jsonb WHERE booking_config IS NULL;

ALTER TABLE restaurants
  ADD CONSTRAINT restaurants_booking_config_mode_check
  CHECK (
    jsonb_typeof(booking_config) = 'object'
    AND coalesce(booking_config->>'mode', 'off') IN ('off', 'simple', 'external')
  );

-- ---------------------------------------------------------------------------
-- 2. Personal booking links (R1, R2).
--
-- `token` is 256 bits of CSPRNG (randomBytes(32), base64url, 43 chars) and the
-- primary key: the stored row IS the capability, as in 060. The restaurant and
-- the diner's phone are captured at mint time from an authenticated source
-- (the webhook sender, or the campaign recipient) and are the only identity a
-- booking ever gets: the page and the submit API never trust the URL or body.
--
-- `expires_at` NULL means no expiry (owner 2026-11-12: lifetimes are
-- configurable per restaurant, including none). Single use is enforced by a
-- conditional UPDATE `consumed_at IS NULL AND (expires_at IS NULL OR
-- expires_at > now())` before any booking row is written.
CREATE TABLE booking_tokens (
  token         TEXT PRIMARY KEY CHECK (char_length(token) >= 43),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  -- E.164 with leading '+', as contact_form_tokens.phone.
  phone         TEXT NOT NULL,
  source        TEXT NOT NULL CHECK (source IN ('chat', 'campaign')),
  campaign_id   UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  expires_at    TIMESTAMPTZ,
  consumed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- W2's "one live chat link per sender" lookup (R11) and support questions
-- ("was a link issued to this number?").
CREATE INDEX booking_tokens_restaurant_phone_idx
  ON booking_tokens (restaurant_id, phone, source, created_at DESC);

CREATE INDEX booking_tokens_expires_idx ON booking_tokens (expires_at);

ALTER TABLE booking_tokens ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. Booking requests (spec S3/S4, R4, R5, R19, R21).
--
-- Status moves only pending -> confirmed | declined, through a conditional
-- UPDATE `WHERE id AND restaurant_id AND status = 'pending'`; the CHECK below
-- keeps decided_at in step with that rule so a half-written decision cannot
-- exist. `token` is UNIQUE: one booking per personal link, enforced by the
-- database as well as by the atomic claim. `name` and `notes` are nullable
-- so the R19 retention purge (W3) can clear them and keep the row.
-- A booking never creates a member or a consent row (R21): member_id is only
-- set when the phone already belongs to a member.
CREATE TABLE booking_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id    UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  member_id        UUID REFERENCES members(id) ON DELETE SET NULL,
  phone            TEXT NOT NULL,
  name             TEXT CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 60),
  party_size       INTEGER NOT NULL CHECK (party_size BETWEEN 1 AND 1000),
  booking_date     DATE NOT NULL,
  booking_time     TIME NOT NULL,
  notes            TEXT CHECK (notes IS NULL OR char_length(notes) <= 500),
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'confirmed', 'declined')),
  decline_reason   TEXT CHECK (decline_reason IS NULL OR char_length(decline_reason) <= 200),
  decided_by       UUID,
  decided_at       TIMESTAMPTZ,
  reminder_sent_at TIMESTAMPTZ,
  source           TEXT NOT NULL CHECK (source IN ('chat', 'campaign')),
  campaign_id      UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  token            TEXT UNIQUE REFERENCES booking_tokens(token) ON DELETE SET NULL,
  pii_purged_at    TIMESTAMPTZ,
  -- Whether the confirm/decline message reached the diner (review F9), so the
  -- dashboard's "not delivered" badge survives a reload. NULL = no decision
  -- message yet (pending) or not recorded.
  decision_message_status TEXT
    CHECK (decision_message_status IS NULL OR decision_message_status IN ('delivered', 'not_delivered')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT booking_requests_decision_consistent
    CHECK ((status = 'pending') = (decided_at IS NULL))
);

-- Dashboard list: this restaurant's requests, newest first (plan budget:
-- 200 rows <= 500 ms).
CREATE INDEX booking_requests_restaurant_status_created_idx
  ON booking_requests (restaurant_id, status, created_at DESC);

CREATE INDEX booking_requests_restaurant_created_idx
  ON booking_requests (restaurant_id, created_at DESC);

-- R11: pending requests per phone per restaurant (cap of 3).
CREATE INDEX booking_requests_restaurant_phone_status_idx
  ON booking_requests (restaurant_id, phone, status);

-- W3 reminder cron: confirmed bookings whose reminder has not gone out.
CREATE INDEX booking_requests_reminder_due_idx
  ON booking_requests (booking_date, booking_time)
  WHERE status = 'confirmed' AND reminder_sent_at IS NULL;

-- W3 retention purge (R19): rows not yet purged, by booking date (review G-A1).
CREATE INDEX booking_requests_retention_idx
  ON booking_requests (booking_date)
  WHERE pii_purged_at IS NULL;

-- Reuses update_updated_at_column() defined in migration 035.
CREATE TRIGGER set_booking_requests_updated_at
  BEFORE UPDATE ON booking_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE booking_requests ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 4. Classifier decisions on inbound free text (W2; spec AC-7, R17).
--
-- No text column by design: only the label, confidence and what we did. The
-- label and confidence are null when the call errored or timed out.
CREATE TABLE inbound_classifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  -- The inbound WhatsApp message id (wamid), as the webhook receives it.
  message_id    TEXT NOT NULL,
  label         TEXT,
  confidence    DOUBLE PRECISION CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  outcome       TEXT NOT NULL CHECK (outcome IN ('booking_reply', 'fallback', 'error')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inbound_classifications_message_unique UNIQUE (restaurant_id, message_id)
);

CREATE INDEX inbound_classifications_restaurant_created_idx
  ON inbound_classifications (restaurant_id, created_at DESC);

ALTER TABLE inbound_classifications ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 5. Campaign "Book now" button (W3; spec AC-16, AC-17, R14).
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS book_now_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS booking_url TEXT;

ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_booking_url_https_check
  CHECK (booking_url IS NULL OR (booking_url ~ '^https://[^/?#\s]+' AND char_length(booking_url) <= 2048));

-- ---------------------------------------------------------------------------
-- 6. Reminder candidates (W3 cron; spec AC-15; review F7 / S-4).
--
-- The start window is applied here, not in the worker: a booking is due when
-- it is confirmed, not yet reminded, starts in (p_now, p_now + lead] and was
-- made at least `lead` before its start (a booking made later gets no
-- reminder). booking_date/booking_time are Hong Kong wall-clock time. Ordered
-- by start so the batch limit never cuts off a due booking behind rows that
-- will never be due. The booking_date range lets the planner use
-- booking_requests_reminder_due_idx. The caller still claims each row with a
-- conditional UPDATE on reminder_sent_at IS NULL.
--
-- Service role only (same lockdown as 064/079): it returns diners' phones and
-- names across every restaurant.
CREATE OR REPLACE FUNCTION public.booking_reminder_candidates(
  p_now timestamptz,
  p_lead_hours int,
  p_limit int
) RETURNS SETOF booking_requests AS $$
  SELECT b.*
  FROM booking_requests b
  WHERE b.status = 'confirmed'
    AND b.reminder_sent_at IS NULL
    AND b.booking_date BETWEEN (p_now AT TIME ZONE 'Asia/Hong_Kong')::date
                           AND ((p_now + make_interval(hours => p_lead_hours)) AT TIME ZONE 'Asia/Hong_Kong')::date
    AND (b.booking_date + b.booking_time) AT TIME ZONE 'Asia/Hong_Kong' > p_now
    AND (b.booking_date + b.booking_time) AT TIME ZONE 'Asia/Hong_Kong' <= p_now + make_interval(hours => p_lead_hours)
    AND b.created_at <= (b.booking_date + b.booking_time) AT TIME ZONE 'Asia/Hong_Kong' - make_interval(hours => p_lead_hours)
  ORDER BY b.booking_date, b.booking_time, b.id
  LIMIT p_limit
$$ LANGUAGE sql STABLE;

REVOKE ALL ON FUNCTION public.booking_reminder_candidates(timestamptz, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_reminder_candidates(timestamptz, int, int) TO service_role;
