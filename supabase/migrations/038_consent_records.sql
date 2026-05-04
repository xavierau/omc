-- WAQ-004: opt-in consent records.
-- One row per (tenant, contact, message category). The send path looks up
-- (restaurant_id, phone_e164, category, status) before sending a marketing
-- template; absent or non-opted_in lookups skip the send.
--
-- Writer: SOLE writer is the service-role client at
--   src/infrastructure/supabase/repositories/consent-record-repository.ts
-- which bypasses RLS. The SELECT policy below is for tenant dashboards and
-- platform-admin read access only — there are intentionally no INSERT or
-- UPDATE policies (browser-side writes are not supported).

CREATE TABLE consent_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  -- member_id is denormalized: kept on best-effort. The (restaurant_id,
  -- phone_e164) pair is the durable opt-in identity — an audit defence must
  -- survive a member-row delete-and-re-create.
  member_id UUID REFERENCES members(id) ON DELETE SET NULL,
  phone_e164 TEXT NOT NULL,
  category TEXT NOT NULL
    CHECK (category IN ('marketing', 'utility', 'authentication')),
  status TEXT NOT NULL
    CHECK (status IN ('opted_in', 'opted_out', 'pending')),
  -- 'weak' for backfilled / pre-system records (Q4 decision 2026-05-04);
  -- 'strong' for fresh, source-attributed consents. WONB-008 will run a
  -- re-confirmation campaign to upgrade weak records once Green is reached.
  consent_grade TEXT NOT NULL DEFAULT 'strong'
    CHECK (consent_grade IN ('strong', 'weak')),
  source TEXT NOT NULL,
  source_reference TEXT,
  business_name_shown TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  captured_ip TEXT,
  captured_user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pre-send lookup index — covers the WHERE clause of findActiveConsent().
CREATE INDEX idx_consent_lookup
  ON consent_records(restaurant_id, phone_e164, category, status);

-- Import-gate uniqueness: at most one *active* consent per (tenant, phone,
-- category). Partial index lets opted_out history accumulate freely.
CREATE UNIQUE INDEX idx_consent_active_uniq
  ON consent_records(restaurant_id, phone_e164, category)
  WHERE status IN ('opted_in', 'pending');

-- Audit / dashboard listing.
CREATE INDEX idx_consent_restaurant_captured
  ON consent_records(restaurant_id, captured_at DESC);

CREATE TRIGGER set_consent_records_updated_at
  BEFORE UPDATE ON consent_records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------------
-- RLS — SELECT-only (writes are service-role-bypassed; see top-of-file).
-- ---------------------------------------------------------------------------
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY consent_records_select ON consent_records
  FOR SELECT USING (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );

-- ---------------------------------------------------------------------------
-- Q4 backfill (decision 2026-05-04): every active member receives an
-- opted_in/marketing/weak record sourced 'pre-system migration', timestamped
-- at the member's joined_at. WONB-008 will run a re-confirmation campaign
-- once Green quality is established to upgrade these to 'strong'.
-- ---------------------------------------------------------------------------
INSERT INTO consent_records (
  restaurant_id, member_id, phone_e164, category, status,
  consent_grade, source, captured_at
)
SELECT
  m.restaurant_id,
  m.id,
  m.phone,
  'marketing',
  'opted_in',
  'weak',
  'pre-system migration',
  COALESCE(m.joined_at, now())
FROM members m
WHERE m.status = 'active'
ON CONFLICT DO NOTHING;
