-- BOOK-014 W6b Stripe test-mode walk seed. FAKE tenant, names and phones only. Local stack only
-- (isolated `supabase start`, project whatsapp-crm-w4, DB 127.0.0.1:55622), never a migration.
-- :admin_id = the GoTrue user made by seed-w6b.sh (role 'admin'). No payment account: the walk
-- connects one through Settings -> Booking -> Connect Stripe (real Stripe test mode).
\set ON_ERROR_STOP 1
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

\set RID '22222222-2222-4222-8222-222222222222'
INSERT INTO restaurants (id, name, slug, whatsapp_number, kapso_phone_number_id, booking_config) VALUES (
  :'RID', 'W6b Deposit Kitchen', 'w6b-deposit-kitchen', '+85200000001', 'pn-walk-fake',
  jsonb_build_object(
    'mode', 'simple', 'maxPartySize', 20,
    'bookingHours', jsonb_build_object(
      'scheduleEnabled', true, 'intervalMinutes', 30, 'noticeHours', 0, 'aheadDays', 30, 'special', '[]'::jsonb,
      'tableMinutes', null, 'terms', jsonb_build_object('zh_hk', '', 'en', ''), 'info', jsonb_build_object('address', '', 'phone', '', 'mapUrl', ''),
      'limits', jsonb_build_object('perSlot', 40, 'perMeal', 120),
      'weekly', (SELECT jsonb_object_agg(d, '[{"label":"Lunch","first":"12:00","last":"14:30"},{"label":"Dinner","first":"18:00","last":"23:30"}]'::jsonb)
                   FROM unnest(ARRAY['mon','tue','wed','thu','fri','sat','sun']) d))))
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_tenants (user_id, restaurant_id, role) VALUES (:'admin_id', :'RID', 'admin') ON CONFLICT DO NOTHING;
SELECT id, name, booking_config->>'mode' FROM restaurants WHERE id = :'RID';
