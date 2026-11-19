-- AGENT-003 local walk fixtures: one fake tenant (simple booking, agent auto), one fake member. Local DB only.
INSERT INTO restaurants (id, name, slug, whatsapp_number, kapso_phone_number_id, status, created_at, booking_config, agent_config)
VALUES ('aaaaaaaa-0000-4000-8000-0000000000a3', 'A3 Test Cafe', 'a3-test-cafe', '+85230000003', 'pn-a3-local', 'active', now() - interval '200 days',
  '{"mode":"simple","maxPartySize":12}'::jsonb,
  '{"mode":"auto","knowledge":"A3 Test Cafe, 中環。營業時間每日 11:00-22:00。可以喺 WhatsApp 訂枱。","instructions":"Friendly and short."}'::jsonb);
INSERT INTO members (restaurant_id, phone, name, points_balance)
VALUES ('aaaaaaaa-0000-4000-8000-0000000000a3', '+85290000003', 'A3 Diner', 50);
