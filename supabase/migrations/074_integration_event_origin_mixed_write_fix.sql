-- INT-001 WI-14 (I-7): fixes a mis-attribution in migration 073's sticky
-- COALESCE origin-attribution logic (069-073 are frozen; this is a NEW
-- migration, `member_updated_outbox`/`consent_changed_outbox`/
-- `member_ref_outbox` are all `CREATE OR REPLACE`d again here with only the
-- ON CONFLICT origin_integration_id formula changed -- everything else is
-- copied verbatim from 073).
--
-- Bug (review 2026-09-10-int-001-analyzer, I-7): 073's ON CONFLICT branch
-- kept origin STICKY -- `COALESCE(existing, EXCLUDED)` -- so the FIRST
-- writer into a 5s coalescing bucket wins attribution for the WHOLE merged
-- event, even when a SECOND, unrelated writer with a DIFFERENT origin (or
-- no origin at all) lands in the same bucket. Concretely: partner A's job
-- inserts a `utility` pending consent row (origin A) and, inside the same
-- 5s bucket, the member independently texts STOP (a `marketing` row ->
-- opted_out, origin NULL, written by the WhatsApp inbound path, NOT
-- partner A). Both writes coalesce into ONE `member.updated
-- {changed:['consent'], origin_integration_id: A}` row. A partner
-- following the documented "ignore events whose origin_integration_id is
-- yours" rule then silently drops the member's own STOP.
--
-- COALESCE(existing, EXCLUDED) treats a NULL incoming write as "no
-- opinion", so it always keeps whichever side is non-null -- that is
-- EXACTLY the attributed-vs-unattributed collision above, regardless of
-- write order (`COALESCE(A, NULL) = A` and `COALESCE(NULL, A) = A`
-- alike). A plain "keep existing over incoming non-null" formula (adopt on
-- null, keep on null) has the SAME flaw for this exact scenario -- it,
-- too, treats the STOP's NULL as "no opinion" rather than as "this write
-- was not partner A's", so it was rejected in favour of the strict
-- version below.
--
-- Fix: keep the origin ONLY when the existing row and the incoming write
-- are IDENTICAL (`IS NOT DISTINCT FROM`, so NULL=NULL counts as agreement
-- too) -- i.e. every write that has landed in this bucket so far agrees on
-- attribution. The moment a second write disagrees (attributed vs
-- unattributed, or two different attributions), the bucket becomes NULL
-- ("mixed/unknown") and STAYS NULL for any further merges into it in that
-- window (NULL IS NOT DISTINCT FROM anything-but-NULL is false, so once
-- NULL it can only stay NULL or coincidentally match another NULL write).
--
--   origin_integration_id = CASE
--     WHEN integration_events.origin_integration_id
--          IS NOT DISTINCT FROM EXCLUDED.origin_integration_id
--       THEN integration_events.origin_integration_id  -- every write so far agrees
--     ELSE NULL                                          -- disagreement -> mixed/unknown
--   END
--
-- Documented consequence (partner doc update, out of this migration): a
-- coalesced event may now carry NULL even when the partner DID contribute
-- a write to it, if another writer landed in the same 5s bucket with no/
-- different attribution -- partners must treat NULL as "cannot be safely
-- attributed to you", never as "not yours" (dropping it on that
-- assumption is exactly the bug this migration closes).

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
    origin_integration_id = CASE
      WHEN integration_events.origin_integration_id IS NOT DISTINCT FROM EXCLUDED.origin_integration_id
        THEN integration_events.origin_integration_id
      ELSE NULL
    END;
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
    origin_integration_id = CASE
      WHEN integration_events.origin_integration_id IS NOT DISTINCT FROM EXCLUDED.origin_integration_id
        THEN integration_events.origin_integration_id
      ELSE NULL
    END;
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
    origin_integration_id = CASE
      WHEN integration_events.origin_integration_id IS NOT DISTINCT FROM EXCLUDED.origin_integration_id
        THEN integration_events.origin_integration_id
      ELSE NULL
    END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
