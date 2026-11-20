\set ON_ERROR_STOP 1
BEGIN;
INSERT INTO restaurants (id, name, slug, whatsapp_number) VALUES ('00000000-0000-0000-0000-0000000000a1', 'R', 'r-w1', '+85200000001');
-- A1: no terms (every booking today) is accepted
INSERT INTO booking_requests (restaurant_id, phone, party_size, booking_date, booking_time, source) VALUES ('00000000-0000-0000-0000-0000000000a1', '+852', 2, '2026-11-24', '19:30', 'chat') RETURNING 'A1 ok', terms_accepted_at, terms_text;
-- A2: both set is accepted
INSERT INTO booking_requests (restaurant_id, phone, party_size, booking_date, booking_time, source, terms_accepted_at, terms_text) VALUES ('00000000-0000-0000-0000-0000000000a1', '+852', 2, '2026-11-24', '19:30', 'chat', now(), '請準時' || E'\n\n' || 'Be on time') RETURNING 'A2 ok', terms_accepted_at IS NOT NULL, terms_text;
-- A3: 2,002 characters is the maximum
INSERT INTO booking_requests (restaurant_id, phone, party_size, booking_date, booking_time, source, terms_accepted_at, terms_text) VALUES ('00000000-0000-0000-0000-0000000000a1', '+852', 2, '2026-11-24', '19:30', 'chat', now(), repeat('訂', 2002)) RETURNING 'A3 ok', char_length(terms_text);
\set ON_ERROR_STOP 0
SAVEPOINT s;
-- A4: time without text -> violation
INSERT INTO booking_requests (restaurant_id, phone, party_size, booking_date, booking_time, source, terms_accepted_at) VALUES ('00000000-0000-0000-0000-0000000000a1', '+852', 2, '2026-11-24', '19:30', 'chat', now());
ROLLBACK TO SAVEPOINT s;
-- A5: text without time -> violation
INSERT INTO booking_requests (restaurant_id, phone, party_size, booking_date, booking_time, source, terms_text) VALUES ('00000000-0000-0000-0000-0000000000a1', '+852', 2, '2026-11-24', '19:30', 'chat', 'x');
ROLLBACK TO SAVEPOINT s;
-- A6: empty text -> violation
INSERT INTO booking_requests (restaurant_id, phone, party_size, booking_date, booking_time, source, terms_accepted_at, terms_text) VALUES ('00000000-0000-0000-0000-0000000000a1', '+852', 2, '2026-11-24', '19:30', 'chat', now(), '');
ROLLBACK TO SAVEPOINT s;
-- A7: 2,003 characters -> violation
INSERT INTO booking_requests (restaurant_id, phone, party_size, booking_date, booking_time, source, terms_accepted_at, terms_text) VALUES ('00000000-0000-0000-0000-0000000000a1', '+852', 2, '2026-11-24', '19:30', 'chat', now(), repeat('x', 2003));
ROLLBACK TO SAVEPOINT s;
SELECT 'rows kept', count(*) FROM booking_requests WHERE restaurant_id = '00000000-0000-0000-0000-0000000000a1';
ROLLBACK;
