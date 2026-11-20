-- INT-001 WI-1: async job record for the partner POST /members endpoint
-- (T-H3b, T-H4, T-H7) plus the durable external-ref link the seam upserts.
--
-- integration_member_jobs is polled by the partner via GET .../jobs/{jobId}.
-- It carries NO phone or name (T-M1: audit needs the action taken, not the
-- PII -- the member row already holds the phone). Writer: SOLE writer is
-- the service-role client at
--   src/infrastructure/supabase/repositories/integration-member-job-repository.ts

CREATE TABLE integration_member_jobs (
  job_id TEXT PRIMARY KEY,
  integration_id UUID NOT NULL REFERENCES pos_integrations(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  status TEXT NOT NULL
    CHECK (status IN ('queued', 'processing', 'succeeded', 'failed')),
  outcome TEXT CHECK (outcome IN ('created', 'existing')),
  member_id UUID REFERENCES members(id) ON DELETE SET NULL,
  error_code TEXT,
  error_message TEXT,
  attempts INT NOT NULL DEFAULT 0,
  asserted_level TEXT NOT NULL CHECK (asserted_level IN ('none', 'utility', 'all')),
  send_welcome BOOLEAN NOT NULL DEFAULT true,
  consent_actions JSONB,
  welcome_outcome TEXT,
  welcome_detail JSONB,
  metadata JSONB,
  external_ref TEXT,
  -- Last 4 digits only, for support/ops correlation without storing the
  -- full number on a row this table's own RLS/audit story doesn't cover.
  phone_last4 TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  result_expires_at TIMESTAMPTZ
);

CREATE INDEX idx_integration_member_jobs_integration
  ON integration_member_jobs(integration_id, submitted_at DESC);
CREATE INDEX idx_integration_member_jobs_restaurant
  ON integration_member_jobs(restaurant_id, submitted_at DESC);
CREATE INDEX idx_integration_member_jobs_active
  ON integration_member_jobs(status) WHERE status IN ('queued', 'processing');

ALTER TABLE integration_member_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY integration_member_jobs_service
  ON integration_member_jobs FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- One row per (member, integration): the durable link the seam upserts so a
-- second partner_api create for the same external_ref resolves to the same
-- member without a second consent/job round-trip.
CREATE TABLE integration_member_refs (
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL REFERENCES pos_integrations(id) ON DELETE CASCADE,
  external_ref TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, integration_id)
);

CREATE INDEX idx_integration_member_refs_lookup
  ON integration_member_refs(integration_id, external_ref);

CREATE TRIGGER set_integration_member_refs_updated_at
  BEFORE UPDATE ON integration_member_refs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE integration_member_refs ENABLE ROW LEVEL SECURITY;
CREATE POLICY integration_member_refs_service
  ON integration_member_refs FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
