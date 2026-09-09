-- INT-001 WI-1: outbound event/delivery outbox (US-6, US-9).
--
-- integration_events is the append-mostly outbox: `member.created` is
-- inserted directly by the create-or-get-member seam (fast path);
-- `member.updated` is produced entirely by DB triggers on members,
-- consent_records and integration_member_refs, coalesced per
-- (member_id, 5-second bucket) so a burst of column changes in the same
-- window becomes one event with a unioned `changed` array.
--
-- integration_deliveries is the per-subscriber fan-out of each event,
-- populated by the AFTER INSERT trigger below. The delivery *processor*
-- (WI-6) re-materialises the payload from Postgres at attempt time — the
-- job only ever carries a deliveryId (T-H7).
--
-- Writers: SOLE writers are the service-role clients at
--   src/infrastructure/supabase/repositories/integration-event-repository.ts
--   src/infrastructure/supabase/repositories/integration-delivery-repository.ts
-- (both land in WI-6); this migration also writes via the triggers below,
-- which run as the table owner and are therefore unaffected by RLS.

CREATE TABLE integration_events (
  id TEXT PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  member_id UUID REFERENCES members(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('member.created', 'member.updated', 'ping')),
  changed TEXT[] NOT NULL DEFAULT '{}',
  source TEXT,
  origin_integration_id UUID,
  -- 5-second coalescing bucket for member.updated (floor(epoch/5)); NULL for
  -- member.created/ping, which are never coalesced.
  coalesce_bucket BIGINT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_integration_events_updated_coalesce
  ON integration_events(member_id, type, coalesce_bucket)
  WHERE type = 'member.updated';

CREATE INDEX idx_integration_events_restaurant_occurred
  ON integration_events(restaurant_id, occurred_at DESC);

CREATE TABLE integration_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID NOT NULL REFERENCES pos_integrations(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES integration_events(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (
    status IN ('queued', 'delivering', 'retrying', 'delivered', 'dead_lettered', 'paused', 'skipped')
  ),
  attempts INT NOT NULL DEFAULT 0,
  last_http_status INT,
  last_error_code TEXT,
  last_response_excerpt TEXT CHECK (char_length(last_response_excerpt) <= 512),
  last_latency_ms INT,
  next_retry_at TIMESTAMPTZ,
  enqueued_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  dead_lettered_at TIMESTAMPTZ,
  retried_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (integration_id, event_id)
);

CREATE INDEX idx_integration_deliveries_integration_created
  ON integration_deliveries(integration_id, created_at DESC);
CREATE INDEX idx_integration_deliveries_relay
  ON integration_deliveries(status, created_at) WHERE status IN ('queued', 'paused');

CREATE TRIGGER set_integration_deliveries_updated_at
  BEFORE UPDATE ON integration_deliveries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE integration_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY integration_events_service
  ON integration_events FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY integration_deliveries_service
  ON integration_deliveries FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Fan-out: one delivery row per subscribed+enabled+acknowledged integration.
-- `ping` bypasses only the outbound_events subscription-list check (it is a
-- manual per-integration test action, never a subscribable type) — it still
-- requires the integration to be fully configured (enabled, URL saved, PII
-- acknowledged), matching WI-6's saved-URL-only test-event rule.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION integration_events_fanout()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO integration_deliveries (integration_id, restaurant_id, event_id, status)
  SELECT
    s.integration_id,
    NEW.restaurant_id,
    NEW.id,
    CASE WHEN s.outbound_status = 'active' THEN 'queued' ELSE 'paused' END
  FROM integration_settings s
  WHERE s.restaurant_id = NEW.restaurant_id
    AND s.outbound_enabled
    AND s.outbound_url IS NOT NULL
    AND s.outbound_pii_ack_at IS NOT NULL
    AND (NEW.type = ANY(s.outbound_events) OR NEW.type = 'ping')
  ON CONFLICT (integration_id, event_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_integration_events_fanout
  AFTER INSERT ON integration_events
  FOR EACH ROW EXECUTE FUNCTION integration_events_fanout();

-- ---------------------------------------------------------------------------
-- member.updated outbox triggers. Each upserts a coalesced integration_events
-- row (5-second bucket) with `changed` unioned across concurrent writers.
-- Column-list triggers mean points_balance, last_visit_at,
-- pmm_throttled_until and unreachable_at never produce an event.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION member_updated_outbox()
RETURNS TRIGGER AS $$
DECLARE
  changed_cols TEXT[] := '{}';
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    changed_cols := changed_cols || 'name';
  END IF;
  IF NEW.preferred_language IS DISTINCT FROM OLD.preferred_language THEN
    changed_cols := changed_cols || 'language';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    changed_cols := changed_cols || 'status';
  END IF;
  IF array_length(changed_cols, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO integration_events (id, restaurant_id, member_id, type, changed, coalesce_bucket, occurred_at)
  VALUES (
    'evt_' || gen_random_uuid(),
    NEW.restaurant_id,
    NEW.id,
    'member.updated',
    changed_cols,
    floor(extract(epoch FROM now()) / 5),
    now()
  )
  ON CONFLICT (member_id, type, coalesce_bucket) WHERE type = 'member.updated'
  DO UPDATE SET changed = ARRAY(
    SELECT DISTINCT unnest(integration_events.changed || EXCLUDED.changed)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_member_updated_outbox
  AFTER UPDATE OF name, preferred_language, status ON members
  FOR EACH ROW EXECUTE FUNCTION member_updated_outbox();

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

  INSERT INTO integration_events (id, restaurant_id, member_id, type, changed, coalesce_bucket, occurred_at)
  VALUES (
    'evt_' || gen_random_uuid(),
    target_restaurant_id,
    target_member_id,
    'member.updated',
    ARRAY['consent'],
    floor(extract(epoch FROM now()) / 5),
    now()
  )
  ON CONFLICT (member_id, type, coalesce_bucket) WHERE type = 'member.updated'
  DO UPDATE SET changed = ARRAY(
    SELECT DISTINCT unnest(integration_events.changed || EXCLUDED.changed)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_consent_changed_outbox
  AFTER INSERT OR UPDATE OF status ON consent_records
  FOR EACH ROW EXECUTE FUNCTION consent_changed_outbox();

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

  INSERT INTO integration_events (id, restaurant_id, member_id, type, changed, coalesce_bucket, occurred_at)
  VALUES (
    'evt_' || gen_random_uuid(),
    target_restaurant_id,
    NEW.member_id,
    'member.updated',
    ARRAY['external_ref'],
    floor(extract(epoch FROM now()) / 5),
    now()
  )
  ON CONFLICT (member_id, type, coalesce_bucket) WHERE type = 'member.updated'
  DO UPDATE SET changed = ARRAY(
    SELECT DISTINCT unnest(integration_events.changed || EXCLUDED.changed)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_member_ref_outbox
  AFTER INSERT OR UPDATE OF external_ref ON integration_member_refs
  FOR EACH ROW EXECUTE FUNCTION member_ref_outbox();
