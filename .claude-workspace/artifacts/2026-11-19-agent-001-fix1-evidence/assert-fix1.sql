\set ON_ERROR_STOP 1
BEGIN;
INSERT INTO restaurants (id, name, slug, whatsapp_number) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'Pre-083 A', 'pre-083-a', '+85290000001');
\i supabase/migrations/083_agent_reply.sql
\echo '--- F7a column + FK + partial unique index present'
SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='agent_messages' AND column_name='reply_to_message_id';
SELECT confdeltype AS on_delete FROM pg_constraint WHERE conrelid='agent_messages'::regclass AND contype='f' AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='agent_messages'::regclass AND attname='reply_to_message_id')];
SELECT indexdef FROM pg_indexes WHERE indexname='agent_messages_one_reply_key';
INSERT INTO agent_messages (id, restaurant_id, phone, role, text, wamid) VALUES
  ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000a1','+85291234567','user','hi','wamid.1'),
  ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-0000000000a1','+85291234567','user','hi 2','wamid.2');
INSERT INTO agent_messages (restaurant_id, phone, role, outcome, text, model, reply_to_message_id) VALUES
  ('00000000-0000-0000-0000-0000000000a1','+85291234567','model','sent','reply','gemini-3.8-flash','11111111-1111-1111-1111-111111111111') RETURNING outcome, reply_to_message_id;
\echo '--- F7b a second sent / fallback / shadow_draft row for the same user row -> unique_violation'
DO $$ BEGIN INSERT INTO agent_messages (restaurant_id, phone, role, outcome, text, model, reply_to_message_id) VALUES ('00000000-0000-0000-0000-0000000000a1','+85291234567','model','sent','again','m','11111111-1111-1111-1111-111111111111'); RAISE EXCEPTION 'F7b-sent FAILED'; EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'F7b ok: second sent -> unique_violation (23505)'; END $$;
DO $$ BEGIN INSERT INTO agent_messages (restaurant_id, phone, role, outcome, model, reply_to_message_id) VALUES ('00000000-0000-0000-0000-0000000000a1','+85291234567','model','fallback','m','11111111-1111-1111-1111-111111111111'); RAISE EXCEPTION 'F7b-fallback FAILED'; EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'F7b ok: fallback after sent -> unique_violation'; END $$;
DO $$ BEGIN INSERT INTO agent_messages (restaurant_id, phone, role, outcome, text, model, reply_to_message_id) VALUES ('00000000-0000-0000-0000-0000000000a1','+85291234567','model','shadow_draft','d','m','11111111-1111-1111-1111-111111111111'); RAISE EXCEPTION 'F7b-draft FAILED'; EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'F7b ok: shadow_draft after sent -> unique_violation'; END $$;
\echo '--- F7c skipped/error rows for the same user row are allowed; another user row is independent; null reply_to is many'
INSERT INTO agent_messages (restaurant_id, phone, role, outcome, text, model, reply_to_message_id) VALUES
  ('00000000-0000-0000-0000-0000000000a1','+85291234567','model','skipped',NULL,'m','11111111-1111-1111-1111-111111111111'),
  ('00000000-0000-0000-0000-0000000000a1','+85291234567','model','error',NULL,'m','11111111-1111-1111-1111-111111111111'),
  ('00000000-0000-0000-0000-0000000000a1','+85291234567','model','sent','r2','m','22222222-2222-2222-2222-222222222222'),
  ('00000000-0000-0000-0000-0000000000a1','+85291234567','model','rate_limited',NULL,NULL,NULL),
  ('00000000-0000-0000-0000-0000000000a1','+85291234567','model','rate_limited',NULL,NULL,NULL) RETURNING outcome;
\echo '--- F7d setModelOutcome sent -> fallback on the claimed row (stays the one answer)'
UPDATE agent_messages SET outcome='fallback' WHERE reply_to_message_id='22222222-2222-2222-2222-222222222222' AND outcome='sent' RETURNING outcome;
\echo '--- F7e a user row cannot carry reply_to_message_id'
DO $$ BEGIN INSERT INTO agent_messages (restaurant_id, phone, role, text, wamid, reply_to_message_id) VALUES ('00000000-0000-0000-0000-0000000000a1','p','user','x','w9','11111111-1111-1111-1111-111111111111'); RAISE EXCEPTION 'F7e FAILED'; EXCEPTION WHEN check_violation THEN RAISE NOTICE 'F7e ok: user row with reply_to rejected'; END $$;
\echo '--- F8 count of model-call rows (model not null, any outcome) for the phone'
SELECT count(*) AS model_call_rows FROM agent_messages WHERE restaurant_id='00000000-0000-0000-0000-0000000000a1' AND phone='+85291234567' AND model IS NOT NULL;
\echo '--- F7f purge of an old user row keeps its younger answer (ON DELETE SET NULL), one DELETE over both is fine'
INSERT INTO agent_messages (id, restaurant_id, phone, role, text, wamid, created_at) VALUES ('33333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-0000000000a1','+85291234567','user','old','w-old', now() - interval '25 hours');
INSERT INTO agent_messages (restaurant_id, phone, role, outcome, text, model, reply_to_message_id, created_at) VALUES ('00000000-0000-0000-0000-0000000000a1','+85291234567','model','sent','young answer','m','33333333-3333-3333-3333-333333333333', now() - interval '23 hours');
DELETE FROM agent_messages WHERE restaurant_id='00000000-0000-0000-0000-0000000000a1' AND created_at < now() - interval '24 hours' RETURNING text;
SELECT text, reply_to_message_id IS NULL AS reply_to_nulled FROM agent_messages WHERE text='young answer';
UPDATE agent_messages SET created_at = now() - interval '30 hours' WHERE text IN ('hi','reply');
DELETE FROM agent_messages WHERE restaurant_id='00000000-0000-0000-0000-0000000000a1' AND created_at < now() - interval '24 hours' RETURNING text;
\echo '--- W1 invariants still hold: RLS on, 0 policies'
SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('agent_messages','agent_silences') ORDER BY relname;
SELECT count(*) AS policies FROM pg_policies WHERE tablename IN ('agent_messages','agent_silences');
SELECT indexname FROM pg_indexes WHERE tablename IN ('agent_messages','agent_silences') ORDER BY indexname;
ROLLBACK;
