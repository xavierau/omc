-- AGENT-006 local walk fixtures (local DB only; every name, phone and campaign is invented).
-- Tenant: agent auto, booking off, enabledTools left unset → the default set (incl. get_recent_campaigns).
BEGIN;
INSERT INTO restaurants (id, name, slug, whatsapp_number, kapso_phone_number_id, status, created_at, booking_config, agent_config)
VALUES ('aaaaaaaa-0000-4000-8000-0000000000a6', 'A6 Test Izakaya', 'a6-test-izakaya', '+85230000006', 'pn-a6-local', 'active', now() - interval '200 days',
  '{"mode":"off"}'::jsonb,
  '{"mode":"auto","knowledge":"A6 Test Izakaya, 灣仔。營業時間每日 18:00-23:00。","instructions":"Friendly and short.","maxRepliesPerPhonePerHour":60}'::jsonb);
INSERT INTO members (id, restaurant_id, phone, name, points_balance)
VALUES ('aaaaaaaa-0000-4000-8000-00000000a6d1', 'aaaaaaaa-0000-4000-8000-0000000000a6', '+85290000006', 'A6 Diner', 0);
INSERT INTO conversation_windows (restaurant_id, phone_e164, opened_at, last_inbound_at, expires_at)
VALUES ('aaaaaaaa-0000-4000-8000-0000000000a6', '+85290000006', now(), now(), now() + interval '24 hours');

-- Templates as stored by the dashboard (placeholders unrendered).
INSERT INTO whatsapp_templates (id, restaurant_id, name, language, category, status, components) VALUES
('aaaaaaaa-0000-4000-8000-00000000a6e1', 'aaaaaaaa-0000-4000-8000-0000000000a6', 'a6_omakase_night', 'zh_HK', 'MARKETING', 'approved',
 jsonb_build_array(
   jsonb_build_object('type','HEADER','format','TEXT','text','Omakase Night 廚師發辦之夜'),
   jsonb_build_object('type','BODY','text', format('{{customer_name}} 你好！%s (Sat) 晚上 7:30 Omakase Night，12 道菜，每位 HK$880（另加一）。名額有限。', to_char((now() at time zone 'Asia/Hong_Kong')::date + 10, 'YYYY-MM-DD'))),
   jsonb_build_object('type','BUTTONS','buttons', jsonb_build_array(jsonb_build_object('type','URL','text','Book now','url','https://example.test/a6/book')))
 )),
('aaaaaaaa-0000-4000-8000-00000000a6e2', 'aaaaaaaa-0000-4000-8000-0000000000a6', 'a6_sake_tasting', 'zh_HK', 'MARKETING', 'approved',
 jsonb_build_array(
   jsonb_build_object('type','BODY','text', format('{{customer_name}} 你好！%s 晚上 8:00 Sake Tasting 清酒品酒會，6 款清酒配小食，每位 HK$480。', to_char((now() at time zone 'Asia/Hong_Kong')::date - 10, 'YYYY-MM-DD')))
 )),
('aaaaaaaa-0000-4000-8000-00000000a6e3', 'aaaaaaaa-0000-4000-8000-0000000000a6', 'a6_never_delivered', 'zh_HK', 'MARKETING', 'approved',
 jsonb_build_array(jsonb_build_object('type','BODY','text','Lobster week, HK$999 per person.')));

INSERT INTO campaigns (id, restaurant_id, name, type, template, status, whatsapp_template_id) VALUES
('aaaaaaaa-0000-4000-8000-00000000a6c1', 'aaaaaaaa-0000-4000-8000-0000000000a6', 'Omakase Night', 'promo', 'omakase', 'completed', 'aaaaaaaa-0000-4000-8000-00000000a6e1'),
('aaaaaaaa-0000-4000-8000-00000000a6c2', 'aaaaaaaa-0000-4000-8000-0000000000a6', 'Sake Tasting', 'promo', 'sake', 'completed', 'aaaaaaaa-0000-4000-8000-00000000a6e2'),
('aaaaaaaa-0000-4000-8000-00000000a6c3', 'aaaaaaaa-0000-4000-8000-0000000000a6', 'Lobster Week', 'promo', 'lobster', 'completed', 'aaaaaaaa-0000-4000-8000-00000000a6e3');

-- Sends: Omakase 2 days ago (read), Sake 15 days ago (delivered), Lobster 1 day ago but FAILED (must not count).
INSERT INTO whatsapp_messages (restaurant_id, member_id, campaign_id, phone_e164, direction, category, message_type, template_id, template_name, content_preview, status, queued_at, sent_at) VALUES
('aaaaaaaa-0000-4000-8000-0000000000a6', 'aaaaaaaa-0000-4000-8000-00000000a6d1', 'aaaaaaaa-0000-4000-8000-00000000a6c1', '+85290000006', 'outbound', 'marketing', 'template', 'aaaaaaaa-0000-4000-8000-00000000a6e1', 'a6_omakase_night', 'Omakase Night', 'read', now() - interval '2 days', now() - interval '2 days'),
('aaaaaaaa-0000-4000-8000-0000000000a6', 'aaaaaaaa-0000-4000-8000-00000000a6d1', 'aaaaaaaa-0000-4000-8000-00000000a6c2', '+85290000006', 'outbound', 'marketing', 'template', 'aaaaaaaa-0000-4000-8000-00000000a6e2', 'a6_sake_tasting', 'Sake Tasting', 'delivered', now() - interval '15 days', now() - interval '15 days'),
('aaaaaaaa-0000-4000-8000-0000000000a6', 'aaaaaaaa-0000-4000-8000-00000000a6d1', 'aaaaaaaa-0000-4000-8000-00000000a6c3', '+85290000006', 'outbound', 'marketing', 'template', 'aaaaaaaa-0000-4000-8000-00000000a6e3', 'a6_never_delivered', 'Lobster Week', 'failed', now() - interval '1 day', NULL);
COMMIT;
