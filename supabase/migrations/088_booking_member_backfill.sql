-- BOOK-008: link members and their bookings.
-- Plan: .claude-workspace/plans/2026-11-20-book-007-008-member-bookings.md (steps 4-7);
-- threats: threats/2026-11-20-book-007-008-member-bookings.md (R1, R2, R4, R8).
-- Apply BEFORE deploying the BOOK-008 code: the manual relink writes events of
-- type 'booking.member_relinked' and calls relink_booking_member; the member
-- panel calls member_booking_stats (without it the panel shows no bookings,
-- the rest still loads). Idempotent: safe to run twice.

-- R4: the audit row of a manual link / relink / unlink. 081's full list (20
-- types) + 1 new = 21. Must stay equal to the EventType union in
-- src/domain/entities/event.ts.
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_type_check;
ALTER TABLE events ADD CONSTRAINT events_type_check
  CHECK (type IN (
    'join','redeem','receipt','campaign','points',
    'unsubscribe','reward_redeem',
    'pos_transaction','pos_refund','pos_customer_link',
    'integration_error','whatsapp_error',
    'onboarding_phase_advanced',
    'consent_imported','consent_granted',
    'consent_revoked','consent_expired',
    'stamp','stamp_reversal',
    'reachability_restored',
    'booking.member_relinked'                                     -- NEW (088)
  ));

-- R8: the member panel reads one member's bookings newest first and counts
-- them; both are scoped by restaurant AND member.
CREATE INDEX IF NOT EXISTS booking_requests_restaurant_member_date_idx
  ON booking_requests (restaurant_id, member_id, booking_date DESC, booking_time DESC)
  WHERE member_id IS NOT NULL;

-- R2/R4: staff link, relink or unlink one booking. ONE statement: the
-- compare-and-set UPDATE (the row still holds p_from_member_id, so the audit
-- row's "from" is what it really held) and, only when a row changed, its
-- events row (actor and ids only, no name or phone). The booking is scoped by
-- id AND restaurant and never an unverified one (BOOK-003 R41); a target
-- member must belong to the same restaurant. Nothing changes otherwise.
CREATE OR REPLACE FUNCTION public.relink_booking_member(
  p_id uuid,
  p_restaurant_id uuid,
  p_from_member_id uuid,
  p_to_member_id uuid,
  p_actor_user_id uuid
) RETURNS SETOF booking_requests AS $$
  WITH changed AS (
    UPDATE booking_requests b
       SET member_id = p_to_member_id
     WHERE b.id = p_id AND b.restaurant_id = p_restaurant_id
       AND b.status <> 'unverified'
       AND b.member_id IS NOT DISTINCT FROM p_from_member_id
       AND p_to_member_id IS DISTINCT FROM p_from_member_id
       AND (p_to_member_id IS NULL OR EXISTS (
         SELECT 1 FROM members m WHERE m.id = p_to_member_id AND m.restaurant_id = p_restaurant_id
       ))
    RETURNING b.*
  ), audit AS (
    INSERT INTO events (restaurant_id, member_id, type, actor_user_id, data_json)
    SELECT p_restaurant_id, NULL, 'booking.member_relinked', p_actor_user_id,
           jsonb_build_object('bookingId', c.id, 'fromMemberId', p_from_member_id, 'toMemberId', p_to_member_id)
      FROM changed c
    RETURNING id
  )
  SELECT c.* FROM changed c;
$$ LANGUAGE sql;

REVOKE ALL ON FUNCTION public.relink_booking_member(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.relink_booking_member(uuid, uuid, uuid, uuid, uuid) TO service_role;

-- R8: counts and dates over ALL of one member's bookings (unverified
-- excluded), scoped by restaurant AND member. "Now" is the app's Hong Kong
-- minute (as 087): last = the latest booking date before it, any status;
-- next = the earliest pending or confirmed booking date from it on. Always one row.
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
  next_booking_date date
) AS $$
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE b.status = 'confirmed')::int,
    count(*) FILTER (WHERE b.status = 'cancelled')::int,
    count(*) FILTER (WHERE b.status = 'declined')::int,
    count(*) FILTER (WHERE b.status = 'no_show')::int,
    count(*) FILTER (WHERE b.status = 'pending')::int,
    max(b.booking_date) FILTER (
      WHERE b.booking_date < p_now_date OR (b.booking_date = p_now_date AND b.booking_time < p_now_time)
    ),
    min(b.booking_date) FILTER (
      WHERE b.status IN ('pending', 'confirmed')
        AND (b.booking_date > p_now_date OR (b.booking_date = p_now_date AND b.booking_time >= p_now_time))
    )
  FROM booking_requests b
  WHERE b.restaurant_id = p_restaurant_id AND b.member_id = p_member_id AND b.status <> 'unverified';
$$ LANGUAGE sql STABLE;

REVOKE ALL ON FUNCTION public.member_booking_stats(uuid, uuid, date, time) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_booking_stats(uuid, uuid, date, time) TO service_role;

-- R1: one-off backfill. A booking with no member links to the EXISTING member
-- of the same restaurant whose phone equals the booking phone (members are
-- unique on (restaurant_id, phone), migration 001). Unverified agent bookings
-- are left alone (their phone is unproven until the confirm code). Never
-- creates a member, consent row or opt-in. A second run changes nothing.
UPDATE booking_requests b
   SET member_id = m.id
  FROM members m
 WHERE b.member_id IS NULL
   AND b.status <> 'unverified'
   AND m.restaurant_id = b.restaurant_id
   AND m.phone = b.phone;
