-- WONB-004: contact import wizard — per-batch audit row.
--
-- Each successful submission of the wizard writes one row here + N rows in
-- consent_records (with import_batch_id FK back) + 0..N rows in members
-- (existing-member matches don't insert when merge=true).
--
-- Writer: SOLE writer is the service-role client at
--   src/infrastructure/supabase/repositories/import-batch-repository.ts
-- which bypasses RLS. The SELECT policy below is for tenant dashboards and
-- platform-admin read access only — there are intentionally no INSERT or
-- UPDATE policies (browser-side writes are not supported).

CREATE TABLE import_batch (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  date_range_start DATE NOT NULL,
  date_range_end DATE NOT NULL,
  consent_text_shown TEXT NOT NULL,
  consent_channel TEXT NOT NULL
    CHECK (consent_channel IN ('whatsapp', 'generic', 'service_only', 'none')),
  proof_url TEXT,
  -- Denormalised counts written at commit time. Useful for tenant dashboard
  -- "your imports" summary without an aggregate JOIN against consent_records.
  row_count INTEGER NOT NULL,
  strong_count INTEGER NOT NULL DEFAULT 0,
  medium_count INTEGER NOT NULL DEFAULT 0,
  weak_count INTEGER NOT NULL DEFAULT 0,
  none_count INTEGER NOT NULL DEFAULT 0,
  -- created_by is auth.users.id; not FK'd to avoid cross-schema coupling
  -- (mirrors tenant_onboarding_state.advanced_by, migration 046).
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ib_date_range_valid CHECK (date_range_end >= date_range_start),
  CONSTRAINT ib_proof_required_for_whatsapp CHECK (
    consent_channel != 'whatsapp' OR proof_url IS NOT NULL
  ),
  CONSTRAINT ib_consent_text_min_length CHECK (
    char_length(consent_text_shown) >= 10
  )
);

CREATE INDEX idx_import_batch_restaurant_created
  ON import_batch(restaurant_id, created_at DESC);

ALTER TABLE import_batch ENABLE ROW LEVEL SECURITY;

CREATE POLICY import_batch_select ON import_batch
  FOR SELECT USING (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );
-- Writes via service-role client only. No INSERT/UPDATE/DELETE policies.

-- FK from consent_records → import_batch (nullable: existing rows + JOIN
-- keyword + WONB-007 pending prompts have no batch).
ALTER TABLE consent_records
  ADD COLUMN import_batch_id UUID REFERENCES import_batch(id) ON DELETE SET NULL;

CREATE INDEX idx_consent_records_import_batch
  ON consent_records(import_batch_id)
  WHERE import_batch_id IS NOT NULL;
