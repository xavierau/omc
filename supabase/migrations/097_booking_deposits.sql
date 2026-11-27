-- BOOK-014 W1: booking deposits, collected by a payment provider behind a
-- provider-agnostic port (Stripe Connect Standard first).
-- Spec:    .claude-workspace/specs/2026-11-27-book-014-booking-deposits.md
-- Threats: threats/2026-11-27-book-014-booking-deposits.md (R55, R56, R57, R58, R60)
-- Plan:    plans/2026-11-27-book-014-booking-deposits.md (Domain Model)
--
-- APPLY BEFORE deploying the code that uses it. Additive for the old code:
-- no existing row changes, the two new booking statuses are never written by
-- it, and insert_booking_request_if_room keeps its six named parameters (the
-- new ones default to the old behaviour).
-- One statement per column (the schema-contract parser reads each ADD COLUMN).
--
-- Every new table: RLS on, no policies (service role only). Every new
-- function: EXECUTE revoked from PUBLIC, anon, authenticated; granted to
-- service_role.
--
-- Rollback (before any deposit exists): DROP the functions created below,
-- DROP TABLE deposit_events, booking_deposits, merchant_payment_accounts;
-- re-run 087's status/decision CHECKs, 092's booking_room_refusal,
-- booking_guest_counts, insert_booking_request_if_room (+ 093's search_path)
-- and promote_agent_booking_with_room, and 084's promote_agent_booking.

-- ---------------------------------------------------------------------------
-- 1. A restaurant's account at a payment provider (commerce ADR shape, deposit
-- slice). Standard + direct charges use the platform key with the account id,
-- so no per-restaurant secret is stored. One account per provider per
-- restaurant, and one provider account is linked to at most one restaurant
-- (threat A4).
CREATE TABLE merchant_payment_accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id       UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  provider_code       TEXT NOT NULL CHECK (provider_code ~ '^[a-z][a-z0-9_]{1,30}$'),
  provider_account_id TEXT CHECK (provider_account_id IS NULL OR char_length(provider_account_id) BETWEEN 1 AND 255),
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'restricted', 'disabled')),
  charges_enabled     BOOLEAN NOT NULL DEFAULT false,
  details_submitted   BOOLEAN NOT NULL DEFAULT false,
  currency            TEXT CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  restriction_reason  TEXT CHECK (restriction_reason IS NULL OR char_length(restriction_reason) <= 200),
  last_webhook_at     TIMESTAMPTZ,
  activated_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT merchant_payment_accounts_one_per_provider UNIQUE (restaurant_id, provider_code),
  CONSTRAINT merchant_payment_accounts_provider_account_once UNIQUE (provider_code, provider_account_id),
  -- Active means the provider can take money for this account.
  CONSTRAINT merchant_payment_accounts_active_ready CHECK (
    status <> 'active' OR (charges_enabled AND provider_account_id IS NOT NULL AND currency IS NOT NULL)
  )
);

ALTER TABLE merchant_payment_accounts ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. Booking status vocabulary (spec AC-5, AC-7): awaiting_deposit holds its
-- seats until paid; lapsed = the hold ran out (or the provider was down at
-- submit, R54). Neither is a staff decision, so decided_at stays NULL.
ALTER TABLE booking_requests DROP CONSTRAINT IF EXISTS booking_requests_status_check;
ALTER TABLE booking_requests
  ADD CONSTRAINT booking_requests_status_check
  CHECK (status IN ('unverified', 'pending', 'confirmed', 'declined', 'cancelled', 'no_show', 'awaiting_deposit', 'lapsed'));

ALTER TABLE booking_requests DROP CONSTRAINT IF EXISTS booking_requests_decision_consistent;
ALTER TABLE booking_requests
  ADD CONSTRAINT booking_requests_decision_consistent
  CHECK (
    (status IN ('unverified', 'pending', 'awaiting_deposit', 'lapsed') AND decided_at IS NULL)
    OR (status IN ('confirmed', 'declined', 'no_show') AND decided_at IS NOT NULL)
    OR (status = 'cancelled' AND cancelled_at IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- 3. The deposit of one booking (1:1). Amount in integer minor units, computed
-- by the server from the restaurant's rule (R53). The provider session id is
-- the ONLY key a payment event is matched by (R49); the /p/<token> link is
-- stored as its SHA-256 only (R62). No PII (R61, PDPO DPP2): the row outlives
-- the booking PII purge for reconciliation.
CREATE TABLE booking_deposits (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id        UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  -- NO ACTION: a booking with a deposit cannot be deleted on its own (the
  -- restaurant cascade removes both in one statement).
  booking_id           UUID NOT NULL UNIQUE REFERENCES booking_requests(id),
  account_id           UUID REFERENCES merchant_payment_accounts(id) ON DELETE SET NULL,
  provider_code        TEXT NOT NULL CHECK (provider_code ~ '^[a-z][a-z0-9_]{1,30}$'),
  provider_account_id  TEXT NOT NULL CHECK (char_length(provider_account_id) BETWEEN 1 AND 255),
  amount_minor         INTEGER NOT NULL CHECK (amount_minor > 0),
  currency             TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status               TEXT NOT NULL DEFAULT 'awaiting'
                         CHECK (status IN ('awaiting', 'paid', 'lapsed', 'refund_pending', 'refunded', 'refund_failed', 'kept')),
  hold_expires_at      TIMESTAMPTZ NOT NULL,
  provider_session_id  TEXT UNIQUE CHECK (provider_session_id IS NULL OR char_length(provider_session_id) BETWEEN 1 AND 255),
  session_url          TEXT CHECK (session_url IS NULL OR (char_length(session_url) <= 2048 AND session_url ~ '^https://')),
  link_token_hash      TEXT NOT NULL UNIQUE CHECK (link_token_hash ~ '^[0-9a-f]{64}$'),
  provider_payment_ref TEXT CHECK (provider_payment_ref IS NULL OR char_length(provider_payment_ref) BETWEEN 1 AND 255),
  paid_at              TIMESTAMPTZ,
  refund_ref           TEXT CHECK (refund_ref IS NULL OR char_length(refund_ref) BETWEEN 1 AND 255),
  refund_reason        TEXT CHECK (refund_reason IS NULL OR refund_reason IN ('declined', 'late_payment', 'staff')),
  -- R56: each refund call carries the idempotency key refund:<id>:<attempt>.
  refund_attempts      INTEGER NOT NULL DEFAULT 0 CHECK (refund_attempts >= 0),
  decided_by           UUID,
  decided_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Money was taken in every state but awaiting and lapsed.
  CONSTRAINT booking_deposits_paid_has_ref CHECK (status IN ('awaiting', 'lapsed') OR provider_payment_ref IS NOT NULL),
  CONSTRAINT booking_deposits_refund_has_reason CHECK (
    status NOT IN ('refund_pending', 'refunded', 'refund_failed') OR refund_reason IS NOT NULL
  ),
  CONSTRAINT booking_deposits_kept_decided CHECK (status <> 'kept' OR decided_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS booking_deposits_restaurant_idx ON booking_deposits (restaurant_id);
-- Expiry step: awaiting holds by expiry.
CREATE INDEX IF NOT EXISTS booking_deposits_awaiting_expiry_idx
  ON booking_deposits (hold_expires_at) WHERE status = 'awaiting';
-- Refund webhooks find the deposit by the payment we stored.
CREATE INDEX IF NOT EXISTS booking_deposits_payment_ref_idx
  ON booking_deposits (provider_code, provider_payment_ref) WHERE provider_payment_ref IS NOT NULL;

ALTER TABLE booking_deposits ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 4. Append-only audit of every deposit transition (R60): who (a staff user,
-- the provider, the cron, the system) and when; no PII.
CREATE TABLE deposit_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_id    UUID NOT NULL REFERENCES booking_deposits(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL CHECK (event_type IN (
                  'created', 'session_created', 'session_failed', 'paid', 'lapsed', 'late_payment',
                  'refund_requested', 'refund_succeeded', 'refund_failed', 'kept', 'waived'
                )),
  actor_kind    TEXT NOT NULL CHECK (actor_kind IN ('user', 'provider', 'cron', 'system')),
  actor_user_id UUID,
  provider_ref  TEXT CHECK (provider_ref IS NULL OR char_length(provider_ref) <= 255),
  amount_minor  INTEGER,
  currency      TEXT CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT deposit_events_actor_user CHECK ((actor_kind = 'user') = (actor_user_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS deposit_events_deposit_idx ON deposit_events (deposit_id, created_at);

ALTER TABLE deposit_events ENABLE ROW LEVEL SECURITY;

-- Append-only: no role may UPDATE or DELETE a row (the restaurant/deposit
-- cascade runs as the table owner and still works).
REVOKE UPDATE, DELETE, TRUNCATE ON deposit_events FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.deposit_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'deposit_events is append-only' USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS deposit_events_no_update ON deposit_events;
CREATE TRIGGER deposit_events_no_update
  BEFORE UPDATE ON deposit_events
  FOR EACH ROW EXECUTE FUNCTION public.deposit_events_append_only();

-- Internal helper: one audit row. Not granted to any API role.
CREATE OR REPLACE FUNCTION public.booking_deposit_event(
  p_deposit booking_deposits,
  p_type text,
  p_actor_kind text,
  p_actor_user uuid,
  p_provider_ref text
) RETURNS void AS $$
  INSERT INTO deposit_events (deposit_id, restaurant_id, event_type, actor_kind, actor_user_id, provider_ref, amount_minor, currency)
  VALUES (p_deposit.id, p_deposit.restaurant_id, p_type, p_actor_kind, p_actor_user, p_provider_ref, p_deposit.amount_minor, p_deposit.currency);
$$ LANGUAGE sql SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.booking_deposit_event(booking_deposits, text, text, uuid, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Seats (R55): awaiting_deposit holds seats like pending and confirmed.
-- 092's booking_room_refusal and booking_guest_counts with the status added.
CREATE OR REPLACE FUNCTION public.booking_room_refusal(
  p_restaurant_id uuid,
  p_date date,
  p_time time,
  p_party int,
  p_period_key text,
  p_period_first time,
  p_period_last time,
  p_slot_limit int,
  p_meal_limit int
) RETURNS jsonb AS $$
DECLARE
  v_scope text;
  v_guests int;
BEGIN
  SELECT s.scope INTO v_scope
  FROM booking_stops s
  WHERE s.restaurant_id = p_restaurant_id
    AND s.booking_date = p_date
    AND (
      s.scope = 'day'
      OR (s.scope = 'period' AND s.period_label = p_period_key)
      OR (s.scope = 'slot' AND s.slot_time = to_char(p_time, 'HH24:MI'))
    )
  ORDER BY CASE s.scope WHEN 'day' THEN 0 WHEN 'period' THEN 1 ELSE 2 END
  LIMIT 1;
  IF v_scope IS NOT NULL THEN
    RETURN jsonb_build_object('kind', 'stopped', 'scope', v_scope);
  END IF;

  IF p_slot_limit IS NOT NULL THEN
    SELECT coalesce(sum(b.party_size), 0) INTO v_guests
    FROM booking_requests b
    WHERE b.restaurant_id = p_restaurant_id AND b.booking_date = p_date AND b.booking_time = p_time
      AND b.status IN ('pending', 'confirmed', 'awaiting_deposit');
    IF v_guests + p_party > p_slot_limit THEN
      RETURN jsonb_build_object('kind', 'full', 'scope', 'slot', 'guests', v_guests, 'limit', p_slot_limit);
    END IF;
  END IF;

  IF p_meal_limit IS NOT NULL AND p_period_first IS NOT NULL AND p_period_last IS NOT NULL THEN
    SELECT coalesce(sum(b.party_size), 0) INTO v_guests
    FROM booking_requests b
    WHERE b.restaurant_id = p_restaurant_id AND b.booking_date = p_date
      AND b.booking_time BETWEEN p_period_first AND p_period_last
      AND b.status IN ('pending', 'confirmed', 'awaiting_deposit');
    IF v_guests + p_party > p_meal_limit THEN
      RETURN jsonb_build_object('kind', 'full', 'scope', 'meal', 'guests', v_guests, 'limit', p_meal_limit);
    END IF;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.booking_room_refusal(uuid, date, time, int, text, time, time, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_room_refusal(uuid, date, time, int, text, time, time, int, int) TO service_role;

CREATE OR REPLACE FUNCTION public.booking_guest_counts(
  p_restaurant_id uuid,
  p_from date,
  p_to date
) RETURNS jsonb AS $$
  SELECT coalesce(jsonb_object_agg(d.booking_date::text, d.slots), '{}'::jsonb)
  FROM (
    SELECT t.booking_date, jsonb_object_agg(to_char(t.booking_time, 'HH24:MI'), t.guests) AS slots
    FROM (
      SELECT b.booking_date, b.booking_time, sum(b.party_size)::int AS guests
      FROM booking_requests b
      WHERE b.restaurant_id = p_restaurant_id AND b.booking_date BETWEEN p_from AND p_to
        AND b.status IN ('pending', 'confirmed', 'awaiting_deposit')
      GROUP BY b.booking_date, b.booking_time
    ) t
    GROUP BY t.booking_date
  ) d;
$$ LANGUAGE sql STABLE SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.booking_guest_counts(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_guest_counts(uuid, date, date) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Check-and-insert (092 + 093) gains p_status, p_deposit and p_max_pending.
-- p_status 'awaiting_deposit' requires p_deposit and inserts the deposit row
-- (status awaiting) and its 'created' event in the same transaction as the
-- booking (spec AC-5, R54); 'pending' (the default) refuses a deposit.
-- p_max_pending (R55): when given, the phone may hold fewer than this many
-- pending + awaiting_deposit requests here, counted under the same per-phone
-- lock the PAP promotion takes (phone lock first, then the date lock, in that
-- order everywhere, so the two cannot deadlock); else
-- {"ok": false, "refusal": {"kind": "pending_cap"}}.
-- p_deposit keys: id, provider_code, account_id, provider_account_id,
-- amount_minor, currency, hold_expires_at, link_token_hash (any other key is
-- refused).
DROP FUNCTION IF EXISTS public.insert_booking_request_if_room(jsonb, text, time, time, int, int);
CREATE OR REPLACE FUNCTION public.insert_booking_request_if_room(
  p_row jsonb,
  p_period_key text,
  p_period_first time,
  p_period_last time,
  p_slot_limit int,
  p_meal_limit int,
  p_status text DEFAULT 'pending',
  p_deposit jsonb DEFAULT NULL,
  p_max_pending int DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_allowed text[] := ARRAY[
    'restaurant_id', 'member_id', 'phone', 'name', 'party_size', 'booking_date', 'booking_time', 'notes', 'source',
    'campaign_id', 'token', 'replaces_booking_id', 'terms_accepted_at', 'terms_text'
  ];
  v_deposit_keys text[] := ARRAY[
    'id', 'provider_code', 'account_id', 'provider_account_id', 'amount_minor', 'currency', 'hold_expires_at', 'link_token_hash'
  ];
  v_restaurant uuid := (p_row ->> 'restaurant_id')::uuid;
  v_date date := (p_row ->> 'booking_date')::date;
  v_time time := (p_row ->> 'booking_time')::time;
  v_party int := (p_row ->> 'party_size')::int;
  v_phone text := p_row ->> 'phone';
  v_bad text;
  v_cols text;
  v_refusal jsonb;
  v_held int;
  v_row booking_requests;
  v_deposit booking_deposits;
BEGIN
  IF v_restaurant IS NULL OR v_date IS NULL OR v_time IS NULL OR v_party IS NULL THEN
    RAISE EXCEPTION 'insert_booking_request_if_room: restaurant_id, booking_date, booking_time and party_size are required'
      USING ERRCODE = '22023';
  END IF;
  SELECT k INTO v_bad FROM jsonb_object_keys(p_row) AS k WHERE k <> ALL (v_allowed) LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'insert_booking_request_if_room: column % is not allowed', v_bad USING ERRCODE = '22023';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('pending', 'awaiting_deposit') THEN
    RAISE EXCEPTION 'insert_booking_request_if_room: status % is not allowed', p_status USING ERRCODE = '22023';
  END IF;
  IF (p_status = 'awaiting_deposit') <> (p_deposit IS NOT NULL) THEN
    RAISE EXCEPTION 'insert_booking_request_if_room: a deposit is required exactly for awaiting_deposit' USING ERRCODE = '22023';
  END IF;
  IF p_deposit IS NOT NULL THEN
    SELECT k INTO v_bad FROM jsonb_object_keys(p_deposit) AS k WHERE k <> ALL (v_deposit_keys) LIMIT 1;
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'insert_booking_request_if_room: deposit key % is not allowed', v_bad USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_max_pending IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('book003:promote:' || v_restaurant::text || ':' || v_phone, 0));
    SELECT count(*) INTO v_held
    FROM booking_requests
    WHERE restaurant_id = v_restaurant AND phone = v_phone AND status IN ('pending', 'awaiting_deposit');
    IF v_held >= p_max_pending THEN
      RETURN jsonb_build_object('ok', false, 'refusal', jsonb_build_object('kind', 'pending_cap'));
    END IF;
  END IF;

  PERFORM public.booking_room_lock(v_restaurant, v_date);
  v_refusal := public.booking_room_refusal(
    v_restaurant, v_date, v_time, v_party, p_period_key, p_period_first, p_period_last, p_slot_limit, p_meal_limit
  );
  IF v_refusal IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'refusal', v_refusal);
  END IF;

  SELECT string_agg(quote_ident(k), ', ') INTO v_cols FROM jsonb_object_keys(p_row) AS k;
  EXECUTE format(
    'INSERT INTO booking_requests (%s, status) SELECT %s, $2 FROM jsonb_populate_record(NULL::booking_requests, $1) RETURNING *',
    v_cols, v_cols
  ) USING p_row, p_status INTO v_row;

  IF p_deposit IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'row', to_jsonb(v_row));
  END IF;

  INSERT INTO booking_deposits (
    id, restaurant_id, booking_id, account_id, provider_code, provider_account_id, amount_minor, currency,
    status, hold_expires_at, link_token_hash
  ) VALUES (
    (p_deposit ->> 'id')::uuid, v_restaurant, v_row.id, (p_deposit ->> 'account_id')::uuid, p_deposit ->> 'provider_code',
    p_deposit ->> 'provider_account_id', (p_deposit ->> 'amount_minor')::int, p_deposit ->> 'currency',
    'awaiting', (p_deposit ->> 'hold_expires_at')::timestamptz, p_deposit ->> 'link_token_hash'
  ) RETURNING * INTO v_deposit;
  PERFORM public.booking_deposit_event(v_deposit, 'created', 'system', NULL, NULL);
  RETURN jsonb_build_object('ok', true, 'row', to_jsonb(v_row), 'deposit', to_jsonb(v_deposit));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.insert_booking_request_if_room(jsonb, text, time, time, int, int, text, jsonb, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_booking_request_if_room(jsonb, text, time, time, int, int, text, jsonb, int) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. The per-phone cap (R55) counts awaiting_deposit too: 084's and 092's
-- promotion with the status added (bodies otherwise unchanged).
CREATE OR REPLACE FUNCTION public.promote_agent_booking(
  p_restaurant_id uuid,
  p_phone text,
  p_codes text[],
  p_wamid text,
  p_at timestamptz,
  p_max_pending int
) RETURNS SETOF booking_requests AS $$
DECLARE
  v_room int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('book003:promote:' || p_restaurant_id::text || ':' || p_phone, 0));

  SELECT p_max_pending - count(*) INTO v_room
  FROM booking_requests
  WHERE restaurant_id = p_restaurant_id AND phone = p_phone AND status IN ('pending', 'awaiting_deposit');

  IF v_room <= 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE booking_requests b
  SET status = 'pending', verified_at = p_at, verified_wamid = p_wamid, confirm_code = NULL
  WHERE b.id IN (
      SELECT c.id
      FROM booking_requests c
      WHERE c.restaurant_id = p_restaurant_id
        AND c.phone = p_phone
        AND c.status = 'unverified'
        AND c.confirm_code = ANY (p_codes)
        AND c.verify_expires_at > p_at
      ORDER BY c.created_at, c.id
      LIMIT v_room
    )
    AND b.status = 'unverified'
  RETURNING b.*;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.promote_agent_booking(uuid, text, text[], text, timestamptz, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_agent_booking(uuid, text, text[], text, timestamptz, int) TO service_role;

CREATE OR REPLACE FUNCTION public.promote_agent_booking_with_room(
  p_restaurant_id uuid,
  p_phone text,
  p_codes text[],
  p_wamid text,
  p_at timestamptz,
  p_max_pending int,
  p_rooms jsonb
) RETURNS SETOF booking_requests AS $$
DECLARE
  v_room int;
  v_date date;
  v_candidate booking_requests;
  v_check jsonb;
  v_refusal jsonb;
  v_row booking_requests;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('book003:promote:' || p_restaurant_id::text || ':' || p_phone, 0));

  SELECT p_max_pending - count(*) INTO v_room
  FROM booking_requests
  WHERE restaurant_id = p_restaurant_id AND phone = p_phone AND status IN ('pending', 'awaiting_deposit');

  FOR v_date IN
    SELECT DISTINCT c.booking_date
    FROM booking_requests c
    WHERE c.restaurant_id = p_restaurant_id AND c.phone = p_phone AND c.status = 'unverified'
      AND c.confirm_code = ANY (p_codes) AND c.verify_expires_at > p_at
    ORDER BY 1
  LOOP
    PERFORM public.booking_room_lock(p_restaurant_id, v_date);
  END LOOP;

  FOR v_candidate IN
    SELECT c.*
    FROM booking_requests c
    WHERE c.restaurant_id = p_restaurant_id AND c.phone = p_phone AND c.status = 'unverified'
      AND c.confirm_code = ANY (p_codes) AND c.verify_expires_at > p_at
    ORDER BY c.created_at, c.id
  LOOP
    v_check := coalesce(p_rooms -> v_candidate.id::text, '{}'::jsonb);
    v_refusal := public.booking_room_refusal(
      p_restaurant_id, v_candidate.booking_date, v_candidate.booking_time, v_candidate.party_size,
      v_check ->> 'period_key', (v_check ->> 'period_first')::time, (v_check ->> 'period_last')::time,
      (v_check ->> 'slot_limit')::int, (v_check ->> 'meal_limit')::int
    );
    IF v_refusal IS NOT NULL THEN
      UPDATE booking_requests
         SET status = 'declined', decline_reason = 'full', decided_at = p_at, decided_by = NULL,
             verified_at = p_at, verified_wamid = p_wamid, confirm_code = NULL
       WHERE id = v_candidate.id AND status = 'unverified'
      RETURNING * INTO v_row;
      IF FOUND THEN RETURN NEXT v_row; END IF;
    ELSIF v_room > 0 THEN
      UPDATE booking_requests
         SET status = 'pending', verified_at = p_at, verified_wamid = p_wamid, confirm_code = NULL
       WHERE id = v_candidate.id AND status = 'unverified'
      RETURNING * INTO v_row;
      IF FOUND THEN
        v_room := v_room - 1;
        RETURN NEXT v_row;
      END IF;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.promote_agent_booking_with_room(uuid, text, text[], text, timestamptz, int, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_agent_booking_with_room(uuid, text, text[], text, timestamptz, int, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 8. The hosted payment session was created: store its id and URL once.
CREATE OR REPLACE FUNCTION public.booking_deposit_attach_session(
  p_deposit_id uuid,
  p_session_id text,
  p_session_url text
) RETURNS SETOF booking_deposits AS $$
DECLARE
  v_deposit booking_deposits;
BEGIN
  UPDATE booking_deposits
     SET provider_session_id = p_session_id, session_url = p_session_url, updated_at = now()
   WHERE id = p_deposit_id AND status = 'awaiting' AND provider_session_id IS NULL
  RETURNING * INTO v_deposit;
  IF FOUND THEN
    PERFORM public.booking_deposit_event(v_deposit, 'session_created', 'system', NULL, p_session_id);
    RETURN NEXT v_deposit;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.booking_deposit_attach_session(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_deposit_attach_session(uuid, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 9. Lapse (R55, R57). One awaiting deposit and its awaiting_deposit booking
-- become lapsed together; seats are freed because lapsed counts nowhere.
-- Internal: the caller holds the deposit row lock. Lock order everywhere is
-- deposit row, then booking row, so lapse and paid cannot deadlock.
CREATE OR REPLACE FUNCTION public.booking_deposit_lapse_locked(
  p_deposit booking_deposits,
  p_event text,
  p_actor_kind text
) RETURNS booking_deposits AS $$
DECLARE
  v_deposit booking_deposits;
BEGIN
  UPDATE booking_requests SET status = 'lapsed'
   WHERE id = p_deposit.booking_id AND status = 'awaiting_deposit';
  UPDATE booking_deposits SET status = 'lapsed', updated_at = now()
   WHERE id = p_deposit.id AND status = 'awaiting'
  RETURNING * INTO v_deposit;
  IF FOUND THEN
    PERFORM public.booking_deposit_event(v_deposit, p_event, p_actor_kind, NULL, NULL);
  END IF;
  RETURN v_deposit;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.booking_deposit_lapse_locked(booking_deposits, text, text) FROM PUBLIC, anon, authenticated;

-- The expiry step (cron, every 5 min): lapses only awaiting holds whose
-- hold_expires_at is before the DATABASE's now() (no caller can lapse a live
-- hold), at most p_limit, skipping rows a payment is changing right now.
-- p_deposit_id narrows to one deposit (a provider "session expired" event).
-- Returns the deposits it lapsed (the app then closes their sessions).
CREATE OR REPLACE FUNCTION public.lapse_expired_booking_deposits(
  p_limit int,
  p_deposit_id uuid DEFAULT NULL
) RETURNS SETOF booking_deposits AS $$
DECLARE
  v_id uuid;
  v_deposit booking_deposits;
  v_lapsed booking_deposits;
BEGIN
  FOR v_id IN
    SELECT d.id FROM booking_deposits d
     WHERE d.status = 'awaiting' AND d.hold_expires_at < now()
       AND (p_deposit_id IS NULL OR d.id = p_deposit_id)
     ORDER BY d.hold_expires_at, d.id
     LIMIT greatest(p_limit, 0)
  LOOP
    SELECT * INTO v_deposit FROM booking_deposits
     WHERE id = v_id AND status = 'awaiting' AND hold_expires_at < now()
     FOR UPDATE SKIP LOCKED;
    CONTINUE WHEN NOT FOUND;
    v_lapsed := public.booking_deposit_lapse_locked(v_deposit, 'lapsed', 'cron');
    IF v_lapsed.id IS NOT NULL THEN RETURN NEXT v_lapsed; END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.lapse_expired_booking_deposits(int, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lapse_expired_booking_deposits(int, uuid) TO service_role;

-- R54: the provider failed at submit, so the hold is released in the same
-- request (lapsed, event session_failed), whatever its expiry.
CREATE OR REPLACE FUNCTION public.abandon_booking_deposit(p_deposit_id uuid) RETURNS SETOF booking_deposits AS $$
DECLARE
  v_deposit booking_deposits;
  v_lapsed booking_deposits;
BEGIN
  SELECT * INTO v_deposit FROM booking_deposits WHERE id = p_deposit_id AND status = 'awaiting' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  v_lapsed := public.booking_deposit_lapse_locked(v_deposit, 'session_failed', 'system');
  IF v_lapsed.id IS NOT NULL THEN RETURN NEXT v_lapsed; END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.abandon_booking_deposit(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.abandon_booking_deposit(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 10. A verified, matching payment event (the app checked session id,
-- account, amount, currency, paid and mode: R49, R50). Under the deposit row
-- lock:
-- - awaiting: deposit -> paid and booking awaiting_deposit -> pending, or
--   -> confirmed when staff made it (staff already accepted: decided by its
--   creator, now). Outcome 'paid'.
-- - lapsed with no payment yet (R57, spec AC-8): the lapse won, so the money
--   is refunded: deposit -> refund_pending (late_payment), attempt 1. Outcome
--   'late'; the app then calls the provider refund once.
-- - anything else: 'duplicate', nothing changes (replays, R48).
-- Returns {"outcome": ..., "deposit": row, "booking": row|null}.
CREATE OR REPLACE FUNCTION public.mark_booking_deposit_paid(
  p_deposit_id uuid,
  p_payment_ref text,
  p_at timestamptz
) RETURNS jsonb AS $$
DECLARE
  v_deposit booking_deposits;
  v_booking booking_requests;
BEGIN
  SELECT * INTO v_deposit FROM booking_deposits WHERE id = p_deposit_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  IF v_deposit.status = 'awaiting' THEN
    UPDATE booking_requests b
       SET status = CASE WHEN b.source = 'staff' THEN 'confirmed' ELSE 'pending' END,
           decided_at = CASE WHEN b.source = 'staff' THEN p_at ELSE NULL END,
           decided_by = CASE WHEN b.source = 'staff' THEN b.created_by ELSE NULL END
     WHERE b.id = v_deposit.booking_id AND b.status = 'awaiting_deposit'
    RETURNING b.* INTO v_booking;
    IF FOUND THEN
      UPDATE booking_deposits
         SET status = 'paid', provider_payment_ref = p_payment_ref, paid_at = p_at, updated_at = now()
       WHERE id = v_deposit.id
      RETURNING * INTO v_deposit;
      PERFORM public.booking_deposit_event(v_deposit, 'paid', 'provider', NULL, p_payment_ref);
      RETURN jsonb_build_object('outcome', 'paid', 'deposit', to_jsonb(v_deposit), 'booking', to_jsonb(v_booking));
    END IF;
    -- The booking left awaiting_deposit some other way: keep no money for it.
    PERFORM public.booking_deposit_lapse_locked(v_deposit, 'lapsed', 'system');
    SELECT * INTO v_deposit FROM booking_deposits WHERE id = p_deposit_id;
  END IF;

  IF v_deposit.status = 'lapsed' AND v_deposit.provider_payment_ref IS NULL THEN
    UPDATE booking_deposits
       SET status = 'refund_pending', refund_reason = 'late_payment', provider_payment_ref = p_payment_ref,
           paid_at = p_at, refund_attempts = refund_attempts + 1, updated_at = now()
     WHERE id = v_deposit.id
    RETURNING * INTO v_deposit;
    PERFORM public.booking_deposit_event(v_deposit, 'late_payment', 'provider', NULL, p_payment_ref);
    PERFORM public.booking_deposit_event(v_deposit, 'refund_requested', 'system', NULL, NULL);
    RETURN jsonb_build_object('outcome', 'late', 'deposit', to_jsonb(v_deposit));
  END IF;

  RETURN jsonb_build_object('outcome', 'duplicate', 'deposit', to_jsonb(v_deposit));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.mark_booking_deposit_paid(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_booking_deposit_paid(uuid, text, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 11. Refund and keep (R56, R58). Each is one conditional UPDATE scoped by id
-- AND restaurant, so only one caller wins a transition and a foreign id
-- changes nothing.
-- begin: p_from 'paid' (Refund, decline) needs the booking in one of
-- p_booking_statuses; p_from 'refund_failed' is Retry. Winner gets the row
-- with refund_attempts + 1 and is the only one to call the provider.
CREATE OR REPLACE FUNCTION public.begin_booking_deposit_refund(
  p_deposit_id uuid,
  p_restaurant_id uuid,
  p_from text,
  p_reason text,
  p_booking_statuses text[],
  p_actor_kind text,
  p_actor_user uuid,
  p_at timestamptz
) RETURNS SETOF booking_deposits AS $$
DECLARE
  v_deposit booking_deposits;
BEGIN
  IF p_from NOT IN ('paid', 'refund_failed') THEN
    RAISE EXCEPTION 'begin_booking_deposit_refund: from % is not allowed', p_from USING ERRCODE = '22023';
  END IF;
  UPDATE booking_deposits d
     SET status = 'refund_pending',
         refund_reason = CASE WHEN p_from = 'paid' THEN p_reason ELSE d.refund_reason END,
         refund_attempts = d.refund_attempts + 1,
         refund_ref = NULL,
         decided_by = CASE WHEN p_from = 'paid' THEN p_actor_user ELSE d.decided_by END,
         decided_at = CASE WHEN p_from = 'paid' THEN p_at ELSE d.decided_at END,
         updated_at = now()
   WHERE d.id = p_deposit_id AND d.restaurant_id = p_restaurant_id AND d.status = p_from
     AND (
       p_from = 'refund_failed'
       OR EXISTS (
         SELECT 1 FROM booking_requests b
          WHERE b.id = d.booking_id AND b.restaurant_id = p_restaurant_id AND b.status = ANY (p_booking_statuses)
       )
     )
  RETURNING d.* INTO v_deposit;
  IF FOUND THEN
    PERFORM public.booking_deposit_event(v_deposit, 'refund_requested', p_actor_kind, p_actor_user, NULL);
    RETURN NEXT v_deposit;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.begin_booking_deposit_refund(uuid, uuid, text, text, text[], text, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_booking_deposit_refund(uuid, uuid, text, text, text[], text, uuid, timestamptz) TO service_role;

-- finish: refund_pending -> refunded | refund_failed. From the refund call
-- (p_attempt = the attempt it made) or from a refund webhook (p_attempt NULL:
-- a refund id that differs from a stored one is an older attempt and changes
-- nothing). Stores the refund id. The provider's word on money wins: a
-- refund webhook that says refunded also ends a refund_failed deposit (a call
-- that timed out after the provider refunded).
CREATE OR REPLACE FUNCTION public.finish_booking_deposit_refund(
  p_deposit_id uuid,
  p_attempt int,
  p_outcome text,
  p_refund_ref text,
  p_actor_kind text
) RETURNS SETOF booking_deposits AS $$
DECLARE
  v_deposit booking_deposits;
BEGIN
  IF p_outcome NOT IN ('refunded', 'refund_failed') THEN
    RAISE EXCEPTION 'finish_booking_deposit_refund: outcome % is not allowed', p_outcome USING ERRCODE = '22023';
  END IF;
  UPDATE booking_deposits d
     SET status = p_outcome, refund_ref = coalesce(p_refund_ref, d.refund_ref), updated_at = now()
   WHERE d.id = p_deposit_id
     AND (d.status = 'refund_pending' OR (p_outcome = 'refunded' AND p_attempt IS NULL AND d.status = 'refund_failed'))
     AND (p_attempt IS NULL OR d.refund_attempts = p_attempt)
     AND (p_refund_ref IS NULL OR d.refund_ref IS NULL OR d.refund_ref = p_refund_ref)
  RETURNING d.* INTO v_deposit;
  IF FOUND THEN
    PERFORM public.booking_deposit_event(
      v_deposit, CASE WHEN p_outcome = 'refunded' THEN 'refund_succeeded' ELSE 'refund_failed' END,
      p_actor_kind, NULL, p_refund_ref
    );
    RETURN NEXT v_deposit;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.finish_booking_deposit_refund(uuid, int, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_booking_deposit_refund(uuid, int, text, text, text) TO service_role;

-- keep: paid -> kept (terminal), only while the booking is in one of
-- p_booking_statuses (cancelled / no-show); who and when stored.
CREATE OR REPLACE FUNCTION public.keep_booking_deposit(
  p_deposit_id uuid,
  p_restaurant_id uuid,
  p_booking_statuses text[],
  p_actor_user uuid,
  p_at timestamptz
) RETURNS SETOF booking_deposits AS $$
DECLARE
  v_deposit booking_deposits;
BEGIN
  UPDATE booking_deposits d
     SET status = 'kept', decided_by = p_actor_user, decided_at = p_at, updated_at = now()
   WHERE d.id = p_deposit_id AND d.restaurant_id = p_restaurant_id AND d.status = 'paid'
     AND EXISTS (
       SELECT 1 FROM booking_requests b
        WHERE b.id = d.booking_id AND b.restaurant_id = p_restaurant_id AND b.status = ANY (p_booking_statuses)
     )
  RETURNING d.* INTO v_deposit;
  IF FOUND THEN
    PERFORM public.booking_deposit_event(v_deposit, 'kept', 'user', p_actor_user, NULL);
    RETURN NEXT v_deposit;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.keep_booking_deposit(uuid, uuid, text[], uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.keep_booking_deposit(uuid, uuid, text[], uuid, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 12. Staff never see a deposit hold or a lapsed booking (W1; W4 adds the
-- awaiting_deposit view): the member panel's stats skip them like unverified.
-- 095's function with that one condition; same return type, grants kept.
CREATE OR REPLACE FUNCTION public.member_booking_stats(
  p_member_id uuid,
  p_restaurant_id uuid,
  p_now_date date,
  p_now_time time
) RETURNS TABLE (
  total int,
  confirmed int,
  cancelled int,
  declined int,
  no_show int,
  pending int,
  last_booking_date date,
  next_booking_date date,
  arrived int
) AS $$
  SELECT
    count(*) FILTER (WHERE r.counted)::int,
    count(*) FILTER (WHERE r.counted AND b.status = 'confirmed')::int,
    count(*) FILTER (WHERE r.counted AND b.status = 'cancelled')::int,
    count(*) FILTER (WHERE r.counted AND b.status = 'declined')::int,
    count(*) FILTER (WHERE r.counted AND b.status = 'no_show')::int,
    count(*) FILTER (WHERE r.counted AND b.status = 'pending')::int,
    max(b.booking_date) FILTER (
      WHERE b.status IN ('confirmed', 'no_show')
        AND (b.booking_date < p_now_date OR (b.booking_date = p_now_date AND b.booking_time < p_now_time))
    ),
    min(b.booking_date) FILTER (
      WHERE b.status IN ('pending', 'confirmed')
        AND (b.booking_date > p_now_date OR (b.booking_date = p_now_date AND b.booking_time >= p_now_time))
    ),
    count(*) FILTER (WHERE r.counted AND b.checked_in_at IS NOT NULL)::int
  FROM booking_requests b
  CROSS JOIN LATERAL (
    SELECT b.cancelled_by IS DISTINCT FROM 'change'
       AND NOT (b.replaces_booking_id IS NOT NULL AND b.status IN ('pending', 'declined')) AS counted
  ) r
  WHERE b.restaurant_id = p_restaurant_id AND b.member_id = p_member_id
    AND b.status NOT IN ('unverified', 'awaiting_deposit', 'lapsed');
$$ LANGUAGE sql STABLE;

REVOKE ALL ON FUNCTION public.member_booking_stats(uuid, uuid, date, time) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_booking_stats(uuid, uuid, date, time) TO service_role;
