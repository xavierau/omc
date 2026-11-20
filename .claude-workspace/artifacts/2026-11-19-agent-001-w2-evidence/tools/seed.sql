-- AGENT-001 W2 I-task fixtures: fake tenants, fake member, fake numbers only.
INSERT INTO restaurants (id, name, slug, whatsapp_number, kapso_phone_number_id, status, created_at)
VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'W2 Test Cafe', 'w2-test-cafe', '+85230000000', 'pn-w2-local', 'active', now() - interval '200 days'),
       ('bbbbbbbb-0000-4000-8000-000000000002', 'W2 Other Tenant', 'w2-other-tenant', '+85230000009', 'pn-w2-other', 'active', now() - interval '200 days');
INSERT INTO members (restaurant_id, phone, name, points_balance)
VALUES ('aaaaaaaa-0000-4000-8000-000000000001', '+85290000001', 'W2 Diner', 120);
INSERT INTO rewards (restaurant_id, name, points_cost, discount_type, discount_value)
VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'Free coffee', 100, 'fixed_amount', 30);
-- Tenant B has a thread of its own (cross-tenant check in the live walk).
INSERT INTO agent_messages (id, restaurant_id, phone, role, text, wamid)
VALUES ('cccccccc-0000-4000-8000-00000000000b', 'bbbbbbbb-0000-4000-8000-000000000002', '+85290000099', 'user', 'tenant B diner text', 'wamid.W2.B.1');
