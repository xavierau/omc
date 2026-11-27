-- BOOK-013 local walk seed (r3, reused unchanged for decision 9). FAKE data only (names, phones, tenant). Local
-- stack only (supabase start on 127.0.0.1:54322), never a migration.
-- The admin user is created through GoTrue first (walk-run.sh); :admin_id is its id.
-- Local-only: this CLI image grants API roles only Dxtm by default (memory:
-- incident_no_browser_env_for_db_features), so grant table privileges here.
\set ON_ERROR_STOP 1
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

DELETE FROM events WHERE restaurant_id = '11111111-1111-4111-8111-111111111111';
DELETE FROM booking_requests WHERE restaurant_id = '11111111-1111-4111-8111-111111111111';
DELETE FROM whatsapp_templates WHERE restaurant_id = '11111111-1111-4111-8111-111111111111';
DELETE FROM members WHERE restaurant_id = '11111111-1111-4111-8111-111111111111';
DELETE FROM user_tenants WHERE restaurant_id = '11111111-1111-4111-8111-111111111111';
DELETE FROM restaurants WHERE id = '11111111-1111-4111-8111-111111111111';

INSERT INTO restaurants (id, name, slug, whatsapp_number, kapso_phone_number_id, booking_config) VALUES (
  '11111111-1111-4111-8111-111111111111', 'Walk Test Kitchen', 'walk-test-kitchen', '+85200000000', 'pn-walk-fake',
  jsonb_build_object(
    'mode', 'simple', 'maxPartySize', 20,
    'templateIds', jsonb_build_object(
      'received', jsonb_build_object('en', null, 'zh_hk', null),
      'confirmed', jsonb_build_object('en', '22222222-2222-4222-8222-000000000001', 'zh_hk', '22222222-2222-4222-8222-000000000002'),
      'declined', jsonb_build_object('en', null, 'zh_hk', null),
      'reminder', jsonb_build_object('en', null, 'zh_hk', null),
      'changed', jsonb_build_object('en', null, 'zh_hk', null),
      'cancelled', jsonb_build_object('en', null, 'zh_hk', null)),
    'bookingHours', jsonb_build_object(
      'scheduleEnabled', true, 'intervalMinutes', 30, 'noticeHours', 0, 'aheadDays', 30, 'special', '[]'::jsonb,
      'tableMinutes', null, 'terms', jsonb_build_object('zh_hk', '', 'en', ''), 'info', jsonb_build_object('address', '', 'phone', '', 'mapUrl', ''),
      'limits', jsonb_build_object('perSlot', 20, 'perMeal', 60),
      'weekly', (SELECT jsonb_object_agg(d, '[{"label":"Lunch","first":"12:00","last":"14:30"},{"label":"Dinner","first":"18:00","last":"23:30"}]'::jsonb)
                   FROM unnest(ARRAY['mon','tue','wed','thu','fri','sat','sun']) d))));

INSERT INTO user_tenants (user_id, restaurant_id, role) VALUES (:'admin_id', '11111111-1111-4111-8111-111111111111', 'admin');

INSERT INTO whatsapp_templates (id, restaurant_id, name, language, category, status, components) VALUES
  ('22222222-2222-4222-8222-000000000001', '11111111-1111-4111-8111-111111111111', 'booking_confirmed_walk01', 'en', 'UTILITY', 'approved',
   '[{"type":"BODY","text":"Your table booking is confirmed. Restaurant: {{restaurant}}. Date: {{date}}. Time: {{time}}. Party size: {{party_size}}. If your plans change, please reply to this message to let the restaurant know."}]'),
  ('22222222-2222-4222-8222-000000000002', '11111111-1111-4111-8111-111111111111', 'booking_confirmed_walk01', 'zh_HK', 'UTILITY', 'approved',
   '[{"type":"BODY","text":"你的訂座已確認。餐廳:{{restaurant}}。日期:{{date}}。時間:{{time}}。人數:{{party_size}}位。如行程有變,請直接回覆此訊息通知餐廳。"}]');

INSERT INTO members (restaurant_id, phone, name) VALUES ('11111111-1111-4111-8111-111111111111', '+85223456789', 'Lam Chi Keung');

-- Today (Hong Kong): lunch and dinner, every arrival state, three "Chan" for the search.
INSERT INTO booking_requests (restaurant_id, phone, name, party_size, booking_date, booking_time, status, decided_at, source, checked_in_at, created_by)
SELECT '11111111-1111-4111-8111-111111111111', phone, name, party, (now() AT TIME ZONE 'Asia/Hong_Kong')::date, t::time, status, CASE WHEN status <> 'pending' THEN now() END, source,
       CASE WHEN arrived THEN now() - interval '9 hours' END, CASE WHEN source = 'staff' THEN :'admin_id'::uuid END
  FROM (VALUES
    ('+85291234401', 'Au Ka Yan',      4, '12:30', 'confirmed', 'chat',  true),
    ('+85292223333', 'Chan Siu Fung',  2, '13:00', 'confirmed', 'chat',  false),
    ('+85295550001', 'Lam Tai',        3, '18:00', 'confirmed', 'chat',  false),
    ('+85298761122', 'Chan Wing Yan',  2, '21:30', 'confirmed', 'agent', false),
    ('+85223456780', 'Mr Chan',        6, '22:30', 'confirmed', 'staff', false),
    ('+85261116555', 'Yeung Family',   8, '23:00', 'confirmed', 'chat',  false),
    ('+85290012233', 'Chan Ka Wai',    4, '23:15', 'pending',   'chat',  false),
    ('+85291234402', '陳生',           2, '23:30', 'confirmed', 'chat',  false)
  ) v(phone, name, party, t, status, source, arrived);
UPDATE booking_requests SET status = 'no_show', no_show_marked_at = now(), no_show_marked_by = :'admin_id' WHERE restaurant_id = '11111111-1111-4111-8111-111111111111' AND name = 'Lam Tai';

-- Saturday 2026-11-28: a booking to edit / cancel, and 16 guests at 19:00 (a 6-pax add breaks the 20 per slot limit).
INSERT INTO booking_requests (restaurant_id, phone, name, party_size, booking_date, booking_time, status, decided_at, source) VALUES
  ('11111111-1111-4111-8111-111111111111', '+85297770001', 'Hui Wing',    2, '2026-11-28', '20:30', 'confirmed', now(), 'chat'),
  ('11111111-1111-4111-8111-111111111111', '+85297770002', 'Tsang Group', 16, '2026-11-28', '19:00', 'confirmed', now(), 'chat');

SELECT count(*) AS today FROM booking_requests WHERE restaurant_id = '11111111-1111-4111-8111-111111111111' AND booking_date = (now() AT TIME ZONE 'Asia/Hong_Kong')::date;
