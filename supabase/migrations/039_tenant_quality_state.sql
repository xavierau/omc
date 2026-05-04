-- WAQ-006: per-tenant WhatsApp quality + tier signal forwarded from Meta via
-- Kapso (event: account_quality_update). One row per transition — append-only
-- history, NOT a single mutable row. Two reasons we picked history over a
-- mutable snapshot:
--   1) WAQ-009 auto-pause needs the prior state to detect degradations
--      (GREEN -> YELLOW) without relying on a separate audit log.
--   2) WAQ-012/013 dashboards + alerts read the time-series for trend lines.
-- Latest state per restaurant is materialised on-read via:
--   SELECT DISTINCT ON (restaurant_id) ...
--     ORDER BY restaurant_id, transitioned_at DESC
-- The hot-path index (idx_tqs_restaurant_transitioned) makes that O(1) per
-- tenant in practice.
--
-- Writer: SOLE writer is the service-role client at
--   src/infrastructure/supabase/repositories/quality-state-repository.ts
-- which bypasses RLS. The SELECT policy below is for tenant dashboards and
-- platform-admin read access only — there are intentionally no INSERT or
-- UPDATE policies (browser-side writes are not supported).

CREATE TABLE tenant_quality_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  phone_number_id TEXT NOT NULL,
  quality_rating TEXT NOT NULL
    CHECK (quality_rating IN ('GREEN', 'YELLOW', 'RED', 'UNKNOWN')),
  messaging_tier TEXT,
  flagged BOOLEAN NOT NULL DEFAULT false,
  raw_payload JSONB,
  transitioned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-tenant latest-state lookup (auto-pause + dashboard hot path)
CREATE INDEX idx_tqs_restaurant_transitioned
  ON tenant_quality_state(restaurant_id, transitioned_at DESC);

-- Per-phone forensic lookup (when Kapso doesn't include restaurant_id)
CREATE INDEX idx_tqs_phone_transitioned
  ON tenant_quality_state(phone_number_id, transitioned_at DESC);

-- RLS — SELECT-only (writes are service-role-bypassed; see top-of-file).
ALTER TABLE tenant_quality_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_quality_state_select ON tenant_quality_state
  FOR SELECT USING (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );
