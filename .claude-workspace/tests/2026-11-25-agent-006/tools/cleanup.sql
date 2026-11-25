-- Deletes only the rows seed.sql created (ids below), never a prefix sweep.
BEGIN;
DELETE FROM agent_messages WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000a6';
DELETE FROM agent_silences WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000a6';
DELETE FROM whatsapp_messages WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000a6';
DELETE FROM campaigns WHERE id IN ('aaaaaaaa-0000-4000-8000-00000000a6c1','aaaaaaaa-0000-4000-8000-00000000a6c2','aaaaaaaa-0000-4000-8000-00000000a6c3');
DELETE FROM whatsapp_templates WHERE id IN ('aaaaaaaa-0000-4000-8000-00000000a6e1','aaaaaaaa-0000-4000-8000-00000000a6e2','aaaaaaaa-0000-4000-8000-00000000a6e3');
DELETE FROM conversation_windows WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000a6';
DELETE FROM members WHERE id = 'aaaaaaaa-0000-4000-8000-00000000a6d1';
DELETE FROM restaurants WHERE id = 'aaaaaaaa-0000-4000-8000-0000000000a6';
COMMIT;
