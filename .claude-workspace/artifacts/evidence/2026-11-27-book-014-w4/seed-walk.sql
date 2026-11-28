-- BOOK-014 W4 AC-3 local walk seed. FAKE data only (tenant, names, phones, Stripe ids). Local stack
-- only (isolated `supabase start`, project whatsapp-crm-w4, DB 127.0.0.1:55622), never a migration.
-- :staff_id = the GoTrue user created by seed-walk.sh (role 'staff' in this tenant).
\set ON_ERROR_STOP 1
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

\set RID '11111111-1111-4111-8111-111111111111'
DELETE FROM deposit_events WHERE restaurant_id = :'RID';
DELETE FROM booking_deposits WHERE restaurant_id = :'RID';
DELETE FROM events WHERE restaurant_id = :'RID';
DELETE FROM booking_requests WHERE restaurant_id = :'RID';
DELETE FROM merchant_payment_accounts WHERE restaurant_id = :'RID';
DELETE FROM conversation_windows WHERE restaurant_id = :'RID';
DELETE FROM whatsapp_templates WHERE restaurant_id = :'RID';
DELETE FROM members WHERE restaurant_id = :'RID';
DELETE FROM user_tenants WHERE restaurant_id = :'RID';
DELETE FROM restaurants WHERE id = :'RID';

INSERT INTO restaurants (id, name, slug, whatsapp_number, kapso_phone_number_id, booking_config) VALUES (
  :'RID', 'Walk Test Kitchen', 'walk-test-kitchen', '+85200000000', 'pn-walk-fake',
  jsonb_build_object(
    'mode', 'simple', 'maxPartySize', 20,
    'deposit', jsonb_build_object('enabled', true, 'mode', 'per_guest', 'amount', 100, 'fromPartySize', 1,
                                  'refundNote', jsonb_build_object('zh_hk', '', 'en', '')),
    'bookingHours', jsonb_build_object(
      'scheduleEnabled', true, 'intervalMinutes', 30, 'noticeHours', 0, 'aheadDays', 30, 'special', '[]'::jsonb,
      'tableMinutes', null, 'terms', jsonb_build_object('zh_hk', '', 'en', ''), 'info', jsonb_build_object('address', '', 'phone', '', 'mapUrl', ''),
      'limits', jsonb_build_object('perSlot', 40, 'perMeal', 120),
      'weekly', (SELECT jsonb_object_agg(d, '[{"label":"Lunch","first":"12:00","last":"14:30"},{"label":"Dinner","first":"18:00","last":"23:30"}]'::jsonb)
                   FROM unnest(ARRAY['mon','tue','wed','thu','fri','sat','sun']) d))));

INSERT INTO user_tenants (user_id, restaurant_id, role) VALUES (:'staff_id', :'RID', 'staff');

-- An active (fake) Stripe account: the deposit rule applies to every party.
INSERT INTO merchant_payment_accounts (restaurant_id, provider_code, provider_account_id, status, charges_enabled, details_submitted, currency, activated_at)
VALUES (:'RID', 'stripe', 'acct_walkfake0001', 'active', true, true, 'HKD', now());

-- Bookings today (Hong Kong), one per deposit state, plus yesterday's paid booking to mark no-show.
CREATE TEMP TABLE seed (name text, party int, t time, status text, source text, dep text, reason text, day int DEFAULT 0);
INSERT INTO seed (name, party, t, status, source, dep, reason, day) SELECT v.name, v.party, v.t::time, v.status, v.source, v.dep, v.reason, coalesce(v.day, 0) FROM (VALUES
  ('Wong Awaiting',   2, '12:30', 'awaiting_deposit', 'staff', 'awaiting',       NULL, NULL::int),
  ('Lee Paid',        4, '13:00', 'pending',          'chat',  'paid',           NULL, NULL::int),
  ('Ho Paid',         2, '13:30', 'pending',          'agent', 'paid',           NULL, NULL::int),
  ('Cheung Paid',     6, '18:30', 'confirmed',        'chat',  'paid',           NULL, NULL::int),
  ('Ng No-show',      3, '12:00', 'no_show',          'chat',  'paid',           NULL, NULL::int),
  ('Tam Kept',        2, '19:00', 'cancelled',        'chat',  'kept',           NULL, NULL::int),
  ('Yip Refunded',    4, '19:30', 'cancelled',        'chat',  'refunded',       'staff', NULL::int),
  ('Kwok Pending',    2, '20:00', 'cancelled',        'agent', 'refund_pending', 'staff', NULL::int),
  ('Lau Failed',      5, '20:30', 'declined',         'chat',  'refund_failed',  'declined', NULL::int),
  ('Diner Hold',      5, '19:00', 'awaiting_deposit', 'chat',  'awaiting',       NULL, NULL::int),
  ('Diner Lapsed',    2, '19:00', 'lapsed',           'chat',  'lapsed',         NULL, NULL::int),
  ('Chan No Deposit', 2, '21:00', 'confirmed',        'chat',  NULL,             NULL, NULL::int),
  ('Fong Past',       4, '19:00', 'confirmed',        'chat',  'paid',           NULL, -1)) v(name, party, t, status, source, dep, reason, day);

INSERT INTO booking_requests (restaurant_id, phone, name, party_size, booking_date, booking_time, status, decided_at, decided_by,
                              source, created_by, cancelled_by, cancelled_at, no_show_marked_at, no_show_marked_by, notify_diner)
SELECT :'RID', '+8529' || lpad((1000000 + row_number() OVER ())::text, 7, '0'), s.name, s.party, (now() AT TIME ZONE 'Asia/Hong_Kong')::date + s.day, s.t, s.status,
       CASE WHEN s.status IN ('confirmed', 'declined', 'no_show', 'cancelled') THEN now() - interval '2 hours' END,
       CASE WHEN s.status IN ('confirmed', 'declined', 'no_show') THEN :'staff_id'::uuid END,
       s.source, CASE WHEN s.source = 'staff' THEN :'staff_id'::uuid END,
       CASE WHEN s.status = 'cancelled' THEN 'staff' END, CASE WHEN s.status = 'cancelled' THEN now() - interval '1 hour' END,
       CASE WHEN s.status = 'no_show' THEN now() END, CASE WHEN s.status = 'no_show' THEN :'staff_id'::uuid END, true
  FROM seed s;
UPDATE booking_requests SET cancelled_by_user = :'staff_id' WHERE restaurant_id = :'RID' AND status = 'cancelled';

INSERT INTO booking_deposits (restaurant_id, booking_id, account_id, provider_code, provider_account_id, amount_minor, currency, status, hold_expires_at,
                              provider_session_id, session_url, link_token_hash, provider_payment_ref, paid_at, refund_ref, refund_reason, refund_attempts,
                              decided_by, decided_at)
SELECT :'RID', b.id, a.id, 'stripe', 'acct_walkfake0001', s.party * 10000, 'HKD', s.dep,
       now() + CASE WHEN s.source = 'staff' THEN interval '24 hours' ELSE interval '30 minutes' END,
       'cs_test_walkseed_' || row_number() OVER (), 'https://checkout.stripe.com/c/pay/cs_test_walkseed_' || row_number() OVER (),
       encode(extensions.digest(b.id::text, 'sha256'), 'hex'),
       CASE WHEN s.dep NOT IN ('awaiting', 'lapsed') THEN 'pi_walkfake_' || row_number() OVER () END,
       CASE WHEN s.dep NOT IN ('awaiting', 'lapsed') THEN now() - interval '3 hours' END,
       CASE WHEN s.dep = 'refunded' THEN 're_walkfake_' || row_number() OVER () END,
       s.reason, CASE WHEN s.reason IS NOT NULL THEN 1 ELSE 0 END,
       CASE WHEN s.dep IN ('kept', 'refunded', 'refund_pending', 'refund_failed') THEN :'staff_id'::uuid END,
       CASE WHEN s.dep IN ('kept', 'refunded', 'refund_pending', 'refund_failed') THEN now() - interval '30 minutes' END
  FROM seed s JOIN booking_requests b ON b.restaurant_id = :'RID' AND b.name = s.name
  CROSS JOIN merchant_payment_accounts a
 WHERE a.restaurant_id = :'RID' AND s.dep IS NOT NULL;

-- Lee and Ho wrote in within 24 h: the decline goes out as free text (the Kapso fake logs it).
INSERT INTO conversation_windows (restaurant_id, phone_e164)
SELECT :'RID', phone FROM booking_requests WHERE restaurant_id = :'RID' AND name IN ('Lee Paid', 'Ho Paid');

SELECT b.name || ' | ' || b.status || ' | ' || coalesce(d.status, '-') FROM booking_requests b LEFT JOIN booking_deposits d ON d.booking_id = b.id
 WHERE b.restaurant_id = :'RID' ORDER BY b.booking_time, b.name;
