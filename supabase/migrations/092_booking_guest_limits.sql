-- BOOK-010: guest limits and staff stops (plan D4; spec
-- .claude-workspace/specs/2026-11-20-book-010-guest-limits-and-stop.md;
-- threat R3, R5). Additive: no existing row or function changes, so it can be
-- applied before the code that uses it.
--
-- The limits themselves live in booking_config.bookingHours.limits (JSONB, no
-- column). Period rules (which slot belongs to which meal) stay in
-- TypeScript: the app passes the period's key and slot range and the limits
-- to the functions below, which only count, check stops and write.

-- ---------------------------------------------------------------------------
-- 1. Staff stops (spec S3): a whole day, one period (meal) or one slot of a
-- date stops taking bookings from diners and agents. One row per stopped
-- thing; resuming deletes it. period_label is the period's key (its label, or
-- "HH:MM-HH:MM" when it has none); slot_time is HH:MM. Service role only:
-- RLS on, no policies (threat R3).
CREATE TABLE booking_stops (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  booking_date    DATE NOT NULL,
  scope           TEXT NOT NULL CHECK (scope IN ('day', 'period', 'slot')),
  period_label    TEXT CHECK (period_label IS NULL OR char_length(period_label) BETWEEN 1 AND 40),
  slot_time       TEXT CHECK (slot_time IS NULL OR slot_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  stopped_by      UUID,
  stopped_by_name TEXT CHECK (stopped_by_name IS NULL OR char_length(stopped_by_name) BETWEEN 1 AND 100),
  stopped_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT booking_stops_scope_shape CHECK (
    (scope = 'day' AND period_label IS NULL AND slot_time IS NULL)
    OR (scope = 'period' AND period_label IS NOT NULL AND slot_time IS NULL)
    OR (scope = 'slot' AND period_label IS NULL AND slot_time IS NOT NULL)
  ),
  -- One stop per thing: a second stop of the same thing is a no-op (idempotent POST).
  CONSTRAINT booking_stops_one UNIQUE NULLS NOT DISTINCT (restaurant_id, booking_date, scope, period_label, slot_time)
);

CREATE INDEX IF NOT EXISTS booking_stops_restaurant_date_idx
  ON booking_stops (restaurant_id, booking_date);

ALTER TABLE booking_stops ENABLE ROW LEVEL SECURITY;

-- Guest counts per date (plan budget: one grouped query per request).
CREATE INDEX IF NOT EXISTS booking_requests_restaurant_date_status_idx
  ON booking_requests (restaurant_id, booking_date, status);

-- ---------------------------------------------------------------------------
-- 2. Why a slot cannot take a party, or NULL when it can (spec S2). Counts
-- the guests of pending + confirmed bookings (unverified never count, owner
-- default) at the slot and in the period's slot range on that date, and the
-- stops. The caller holds the date lock (section 3). Internal helper:
-- service role only.
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
      AND b.status IN ('pending', 'confirmed');
    IF v_guests + p_party > p_slot_limit THEN
      RETURN jsonb_build_object('kind', 'full', 'scope', 'slot', 'guests', v_guests, 'limit', p_slot_limit);
    END IF;
  END IF;

  IF p_meal_limit IS NOT NULL AND p_period_first IS NOT NULL AND p_period_last IS NOT NULL THEN
    SELECT coalesce(sum(b.party_size), 0) INTO v_guests
    FROM booking_requests b
    WHERE b.restaurant_id = p_restaurant_id AND b.booking_date = p_date
      AND b.booking_time BETWEEN p_period_first AND p_period_last
      AND b.status IN ('pending', 'confirmed');
    IF v_guests + p_party > p_meal_limit THEN
      RETURN jsonb_build_object('kind', 'full', 'scope', 'meal', 'guests', v_guests, 'limit', p_meal_limit);
    END IF;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

REVOKE ALL ON FUNCTION public.booking_room_refusal(uuid, date, time, int, text, time, time, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_room_refusal(uuid, date, time, int, text, time, time, int, int) TO service_role;

-- The lock every writer that adds guests to (restaurant, date) takes first.
CREATE OR REPLACE FUNCTION public.booking_room_lock(p_restaurant_id uuid, p_date date) RETURNS void AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('book010:room:' || p_restaurant_id::text || ':' || p_date::text, 0));
END;
$$ LANGUAGE plpgsql SET search_path = public;

REVOKE ALL ON FUNCTION public.booking_room_lock(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_room_lock(uuid, date) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Check-and-insert as one atomic step (spec AC-4, AC-5; plan D4; threat R5).
--
-- A transaction-scoped advisory lock on (restaurant, date) serialises every
-- writer that adds guests to that date (this function and section 4), so two
-- requests for the last seats cannot both see room: the second one waits,
-- then counts the first one's committed row. p_row carries the columns the
-- app's insert writes (exactly the keys it would send PostgREST; any other
-- key is refused), so the row is written as the plain insert writes it.
-- Returns {"ok": true, "row": <booking_requests row>} or
-- {"ok": false, "refusal": {kind, scope[, guests, limit]}}.
CREATE OR REPLACE FUNCTION public.insert_booking_request_if_room(
  p_row jsonb,
  p_period_key text,
  p_period_first time,
  p_period_last time,
  p_slot_limit int,
  p_meal_limit int
) RETURNS jsonb AS $$
DECLARE
  v_allowed text[] := ARRAY[
    'restaurant_id', 'member_id', 'phone', 'name', 'party_size', 'booking_date', 'booking_time', 'notes', 'source',
    'campaign_id', 'token', 'replaces_booking_id', 'terms_accepted_at', 'terms_text'
  ];
  v_restaurant uuid := (p_row ->> 'restaurant_id')::uuid;
  v_date date := (p_row ->> 'booking_date')::date;
  v_time time := (p_row ->> 'booking_time')::time;
  v_party int := (p_row ->> 'party_size')::int;
  v_bad text;
  v_cols text;
  v_refusal jsonb;
  v_row booking_requests;
BEGIN
  IF v_restaurant IS NULL OR v_date IS NULL OR v_time IS NULL OR v_party IS NULL THEN
    RAISE EXCEPTION 'insert_booking_request_if_room: restaurant_id, booking_date, booking_time and party_size are required'
      USING ERRCODE = '22023';
  END IF;
  SELECT k INTO v_bad FROM jsonb_object_keys(p_row) AS k WHERE k <> ALL (v_allowed) LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'insert_booking_request_if_room: column % is not allowed', v_bad USING ERRCODE = '22023';
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
    'INSERT INTO booking_requests (%s) SELECT %s FROM jsonb_populate_record(NULL::booking_requests, $1) RETURNING *',
    v_cols, v_cols
  ) USING p_row INTO v_row;
  RETURN jsonb_build_object('ok', true, 'row', to_jsonb(v_row));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.insert_booking_request_if_room(jsonb, text, time, time, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_booking_request_if_room(jsonb, text, time, time, int, int) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. The PAP code step with room (spec AC-6). As promote_agent_booking (084):
-- the phone lock, the code/sender/window match and the pending cap. Then each
-- candidate is checked under its date lock (dates locked in order, so two
-- promotions cannot deadlock): a candidate that no longer fits becomes
-- 'declined' with reason 'full' (no staff action; the app tells the diner),
-- the others become 'pending' while the cap has room. p_rooms maps a booking
-- id to its period key, slot range and limits (computed by the app); a
-- candidate missing from it is checked against stops only. Returns every row
-- it changed (pending and declined).
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
  WHERE restaurant_id = p_restaurant_id AND phone = p_phone AND status = 'pending';

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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.promote_agent_booking_with_room(uuid, text, text[], text, timestamptz, int, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_agent_booking_with_room(uuid, text, text[], text, timestamptz, int, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Guest counts for a date range as ONE value (plan budget: one grouped
-- query per request; a JSON object, so PostgREST max_rows never cuts it):
-- {"YYYY-MM-DD": {"HH:MM": guests, ...}, ...}, pending + confirmed only.
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
        AND b.status IN ('pending', 'confirmed')
      GROUP BY b.booking_date, b.booking_time
    ) t
    GROUP BY t.booking_date
  ) d;
$$ LANGUAGE sql STABLE SET search_path = public;

REVOKE ALL ON FUNCTION public.booking_guest_counts(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_guest_counts(uuid, date, date) TO service_role;
