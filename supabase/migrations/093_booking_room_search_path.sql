-- BOOK-010 F1 (review P3-4): hardening of the two SECURITY DEFINER functions
-- from 092. Their search_path was `public` alone, so an unqualified
-- booking_requests / booking_stops could resolve to a same-named temp table
-- of the calling session first (pg_temp is searched first unless listed).
-- Postgres guidance for SECURITY DEFINER: list pg_temp last.
--
-- Exposure was service_role only (EXECUTE revoked from PUBLIC, anon and
-- authenticated in 092), so this is defence in depth. 092 is not edited in
-- place because it may already be applied somewhere. Idempotent; no row or
-- grant changes.
--
-- Rollback: the same two statements with SET search_path = public.

ALTER FUNCTION public.insert_booking_request_if_room(jsonb, text, time, time, int, int)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.promote_agent_booking_with_room(uuid, text, text[], text, timestamptz, int, jsonb)
  SET search_path = public, pg_temp;
