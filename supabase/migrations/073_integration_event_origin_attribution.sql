-- INT-001 WI-13: closes two gaps WI-11's documentation pass disclosed
-- (artifacts/2026-09-10-int-001-wi11-backend -- partner doc's
-- "origin_integration_id" section and the ops playbook's §7 "known gap").
--
-- ---------------------------------------------------------------------------
-- Gap A -- origin_integration_id on member.updated
-- ---------------------------------------------------------------------------
-- Today only member.created (emitted from the create-or-get-member seam,
-- src/application/create-or-get-member.ts) carries origin_integration_id.
-- Every member.updated row is produced by the three DB triggers below
-- (migration 071), which never set it -- a partner whose OWN API call
-- upgraded a consent record or renamed an external_ref cannot recognise the
-- resulting member.updated as its own echo.
--
-- Why an RPC, not a plain UPDATE with a preceding "set the session var"
-- call: the app's Supabase client (src/infrastructure/supabase/client.ts)
-- talks to Postgres over PostgREST, which runs every HTTP request in its
-- OWN transaction -- a `SET LOCAL`/`set_config(..., true)` made in one
-- request is gone before the next request's transaction begins, even on
-- the same pooled connection. So the config-set and the write that a
-- trigger needs to see it from MUST happen inside the same function call
-- (the same transaction). The three RPCs below do exactly that: set
-- `app.origin_integration_id` for the current transaction only, then
-- perform the write that fires the outbox trigger, atomically.
--
-- Callers (src/infrastructure/supabase/repositories/):
--   consent-record-repository.ts   -- insertConsentRecordWithOrigin /
--                                      upgradeToOptedInWithOrigin, used
--                                      ONLY by applyPartnerAssertedConsent
--                                      (already partner-API-only -- see
--                                      that function's own header)
--   integration-member-ref-repository.ts -- upsertIntegrationMemberRef,
--                                      whose SOLE caller is the
--                                      member-create job processor (WI-3)
-- Every OTHER writer of consent_records (join-consent.ts,
-- prompt-marketing-optin.ts, confirm-marketing-optin.ts,
-- import-contacts-batch-row.ts) is untouched and keeps writing through the
-- plain insertConsentRecord/upgradeToOptedIn path -- those events correctly
-- keep origin_integration_id NULL.

CREATE OR REPLACE FUNCTION current_origin_integration_id()
RETURNS UUID AS $$
DECLARE
  raw TEXT := current_setting('app.origin_integration_id', true);
BEGIN
  IF raw IS NULL OR raw = '' THEN
    RETURN NULL;
  END IF;
  RETURN raw::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- member_updated_outbox / consent_changed_outbox / member_ref_outbox: add
-- origin_integration_id to the INSERT, and make it STICKY (never
-- overwritten by a later coalesced write in the same 5s bucket that has no
-- attribution) on the ON CONFLICT branch via COALESCE(existing, new).
CREATE OR REPLACE FUNCTION member_updated_outbox()
RETURNS TRIGGER AS $$
DECLARE
  changed_cols TEXT[] := '{}';
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    changed_cols := changed_cols || 'name'::text;
  END IF;
  IF NEW.preferred_language IS DISTINCT FROM OLD.preferred_language THEN
    changed_cols := changed_cols || 'language'::text;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    changed_cols := changed_cols || 'status'::text;
  END IF;
  IF array_length(changed_cols, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO integration_events (id, restaurant_id, member_id, type, changed, origin_integration_id, coalesce_bucket, occurred_at)
  VALUES (
    'evt_' || gen_random_uuid(),
    NEW.restaurant_id,
    NEW.id,
    'member.updated',
    changed_cols,
    current_origin_integration_id(),
    floor(extract(epoch FROM now()) / 5),
    now()
  )
  ON CONFLICT (member_id, type, coalesce_bucket) WHERE type = 'member.updated'
  DO UPDATE SET
    changed = ARRAY(SELECT DISTINCT unnest(integration_events.changed || EXCLUDED.changed)),
    origin_integration_id = COALESCE(integration_events.origin_integration_id, EXCLUDED.origin_integration_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION consent_changed_outbox()
RETURNS TRIGGER AS $$
DECLARE
  target_member_id UUID;
  target_restaurant_id UUID;
BEGIN
  SELECT id, restaurant_id INTO target_member_id, target_restaurant_id
  FROM members
  WHERE restaurant_id = NEW.restaurant_id AND phone = NEW.phone_e164
  LIMIT 1;

  IF target_member_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO integration_events (id, restaurant_id, member_id, type, changed, origin_integration_id, coalesce_bucket, occurred_at)
  VALUES (
    'evt_' || gen_random_uuid(),
    target_restaurant_id,
    target_member_id,
    'member.updated',
    ARRAY['consent'],
    current_origin_integration_id(),
    floor(extract(epoch FROM now()) / 5),
    now()
  )
  ON CONFLICT (member_id, type, coalesce_bucket) WHERE type = 'member.updated'
  DO UPDATE SET
    changed = ARRAY(SELECT DISTINCT unnest(integration_events.changed || EXCLUDED.changed)),
    origin_integration_id = COALESCE(integration_events.origin_integration_id, EXCLUDED.origin_integration_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION member_ref_outbox()
RETURNS TRIGGER AS $$
DECLARE
  target_restaurant_id UUID;
BEGIN
  SELECT restaurant_id INTO target_restaurant_id
  FROM members WHERE id = NEW.member_id;

  IF target_restaurant_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO integration_events (id, restaurant_id, member_id, type, changed, origin_integration_id, coalesce_bucket, occurred_at)
  VALUES (
    'evt_' || gen_random_uuid(),
    target_restaurant_id,
    NEW.member_id,
    'member.updated',
    ARRAY['external_ref'],
    current_origin_integration_id(),
    floor(extract(epoch FROM now()) / 5),
    now()
  )
  ON CONFLICT (member_id, type, coalesce_bucket) WHERE type = 'member.updated'
  DO UPDATE SET
    changed = ARRAY(SELECT DISTINCT unnest(integration_events.changed || EXCLUDED.changed)),
    origin_integration_id = COALESCE(integration_events.origin_integration_id, EXCLUDED.origin_integration_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Partner-job-only writers. p_row carries exactly the columns
-- consent-record-mapper.ts's toRow() already produces for the plain insert
-- path (id/created_at/updated_at have Postgres defaults and are NOT listed
-- here, so jsonb_populate_record leaving them NULL never reaches the
-- INSERT column list below).
CREATE OR REPLACE FUNCTION insert_consent_record_with_origin(
  p_row JSONB,
  p_origin_integration_id UUID
) RETURNS consent_records AS $$
DECLARE
  v_row consent_records := jsonb_populate_record(NULL::consent_records, p_row);
  v_result consent_records;
BEGIN
  PERFORM set_config('app.origin_integration_id', p_origin_integration_id::text, true);
  INSERT INTO consent_records (
    id, restaurant_id, member_id, phone_e164, category, status, consent_grade,
    source, source_reference, business_name_shown, captured_at, revoked_at,
    captured_ip, captured_user_agent, proof_url, consent_text_shown,
    expires_at, granted_at, import_batch_id
  ) VALUES (
    v_row.id, v_row.restaurant_id, v_row.member_id, v_row.phone_e164, v_row.category,
    v_row.status, v_row.consent_grade, v_row.source, v_row.source_reference,
    v_row.business_name_shown, v_row.captured_at, v_row.revoked_at,
    v_row.captured_ip, v_row.captured_user_agent, v_row.proof_url,
    v_row.consent_text_shown, v_row.expires_at, v_row.granted_at, v_row.import_batch_id
  )
  RETURNING * INTO v_result;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION upgrade_consent_to_opted_in_with_origin(
  p_restaurant_id UUID,
  p_phone_e164 TEXT,
  p_category TEXT,
  p_origin_integration_id UUID
) RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  PERFORM set_config('app.origin_integration_id', p_origin_integration_id::text, true);
  UPDATE consent_records
  SET status = 'opted_in', granted_at = now()
  WHERE restaurant_id = p_restaurant_id
    AND phone_e164 = p_phone_e164
    AND category = p_category
    AND status = 'pending';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- integration_member_refs is always partner-job-owned data (see file
-- header comment on integration-member-ref-repository.ts) -- its own
-- integration_id IS the origin, no separate parameter needed.
CREATE OR REPLACE FUNCTION upsert_member_ref_with_origin(
  p_member_id UUID,
  p_integration_id UUID,
  p_external_ref TEXT
) RETURNS VOID AS $$
BEGIN
  PERFORM set_config('app.origin_integration_id', p_integration_id::text, true);
  INSERT INTO integration_member_refs (member_id, integration_id, external_ref, updated_at)
  VALUES (p_member_id, p_integration_id, p_external_ref, now())
  ON CONFLICT (member_id, integration_id) DO UPDATE
    SET external_ref = EXCLUDED.external_ref, updated_at = EXCLUDED.updated_at;
END;
$$ LANGUAGE plpgsql;

-- Same lock-down convention as migration 033's delete_member_cascade and
-- migration 067's count_active_members_by_tags: these run as the calling
-- role (no SECURITY DEFINER -- the service-role client that is the sole
-- intended caller already bypasses RLS; a non-service-role caller would
-- still be blocked by consent_records/integration_member_refs' own
-- service_role-only RLS policies even if EXECUTE were left open), but
-- EXECUTE is revoked from anon/authenticated anyway as defense in depth.
REVOKE EXECUTE ON FUNCTION insert_consent_record_with_origin(JSONB, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION insert_consent_record_with_origin(JSONB, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION insert_consent_record_with_origin(JSONB, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION insert_consent_record_with_origin(JSONB, UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION upgrade_consent_to_opted_in_with_origin(UUID, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION upgrade_consent_to_opted_in_with_origin(UUID, TEXT, TEXT, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION upgrade_consent_to_opted_in_with_origin(UUID, TEXT, TEXT, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION upgrade_consent_to_opted_in_with_origin(UUID, TEXT, TEXT, UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION upsert_member_ref_with_origin(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION upsert_member_ref_with_origin(UUID, UUID, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION upsert_member_ref_with_origin(UUID, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION upsert_member_ref_with_origin(UUID, UUID, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- Gap B -- per-integration inbound depth-counter rebuild
-- ---------------------------------------------------------------------------
-- `int001:depth:{integrationId}` (Redis) is only ever incremented at
-- enqueue and decremented at job-terminal-state
-- (src/application/enqueue-member-create.ts,
-- src/application/process-member-create-job.ts) -- a crashed/lost job
-- between those two points permanently inflates the counter. The plan's
-- own architecture text names the fix: "the 5-min sweeper re-derives every
-- counter from integration_member_jobs WHERE status IN
-- ('queued','processing') (a counter is a cache, the table is truth)".
-- These two read-only aggregates are that truth, queried by
-- src/application/reconcile-integration-depth-counters.ts.
CREATE OR REPLACE FUNCTION count_non_terminal_member_jobs_by_integration()
RETURNS TABLE(integration_id UUID, non_terminal_count INTEGER) AS $$
  SELECT integration_id, count(*)::int
  FROM integration_member_jobs
  WHERE status IN ('queued', 'processing')
  GROUP BY integration_id;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION count_non_terminal_member_jobs_for_integration(p_integration_id UUID)
RETURNS INTEGER AS $$
  SELECT count(*)::int
  FROM integration_member_jobs
  WHERE integration_id = p_integration_id
    AND status IN ('queued', 'processing');
$$ LANGUAGE sql STABLE;

REVOKE EXECUTE ON FUNCTION count_non_terminal_member_jobs_by_integration() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION count_non_terminal_member_jobs_by_integration() FROM anon;
REVOKE EXECUTE ON FUNCTION count_non_terminal_member_jobs_by_integration() FROM authenticated;
GRANT EXECUTE ON FUNCTION count_non_terminal_member_jobs_by_integration() TO service_role;

REVOKE EXECUTE ON FUNCTION count_non_terminal_member_jobs_for_integration(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION count_non_terminal_member_jobs_for_integration(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION count_non_terminal_member_jobs_for_integration(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION count_non_terminal_member_jobs_for_integration(UUID) TO service_role;
