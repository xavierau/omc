-- WAQ-011: review queue for new-tenant marketing templates.
--
-- A tenant younger than 90 days OR with recent quality incidents must have
-- an APPROVED `template_review_queue` row before sending a marketing
-- campaign with that template. Once trusted (age >= 90 days, no YELLOW/RED
-- transitions in 90d, not auto-paused), the gate is bypassed at send time —
-- see `src/application/check-tenant-trust.ts`.
--
-- Why a separate table (vs. a flag on `whatsapp_templates`):
--   1) Audience size + audience query at submission time form the audit
--      record — we want to know what was approved, not just "the template".
--   2) Reviewer + decision history per submission. A re-submission after
--      `changes_requested` is a fresh row, not a mutation of the prior.
--   3) Lifecycle is independent of the template itself (a template may
--      survive multiple review rounds).
--
-- Writer: SOLE writer is the service-role client at
--   src/infrastructure/supabase/repositories/template-review-repository.ts
-- which bypasses RLS. The SELECT policy below is for tenant dashboards and
-- platform-admin read access only — there are intentionally no INSERT or
-- UPDATE policies (browser-side writes are not supported).

CREATE TABLE template_review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  -- Optional: a row may reference a concrete `whatsapp_templates` row, but
  -- we keep `template_name` as the source of truth so the gate can match
  -- by name even before/after a template row is created/deleted.
  template_id UUID REFERENCES whatsapp_templates(id) ON DELETE SET NULL,
  template_name TEXT NOT NULL,
  target_audience_size INTEGER,
  target_audience_query JSONB,
  content_preview TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'changes_requested')),
  -- user_id is stored as a plain UUID (no FK to auth.users) to mirror the
  -- pattern in user_tenants / platform_admins / admin_audit_logs (see
  -- migrations 011, 012). The auth.users table is in another schema and we
  -- don't cross schemas for FKs in this codebase.
  submitted_by UUID,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-tenant pending lookup (send-side gate hot path).
CREATE INDEX idx_template_review_queue_restaurant_status
  ON template_review_queue(restaurant_id, status, submitted_at DESC);

-- Global admin queue: list ALL tenants' submissions filtered by status.
-- Without this index, the admin queue query (no restaurant_id filter) cannot
-- use the index above (Postgres can't seek when the leading column is omitted
-- from WHERE), and would degrade to a full scan as the table grows.
CREATE INDEX idx_template_review_queue_status
  ON template_review_queue(status, submitted_at DESC);

-- One pending OR approved entry per (restaurant_id, template_name) at a
-- time. A rejection or changes_requested closes a slot and a fresh
-- submission can open a new one.
CREATE UNIQUE INDEX idx_template_review_queue_active_uniq
  ON template_review_queue(restaurant_id, template_name)
  WHERE status IN ('pending', 'approved');

CREATE TRIGGER set_template_review_queue_updated_at
  BEFORE UPDATE ON template_review_queue
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS — SELECT-only (writes are service-role-bypassed; see top-of-file).
ALTER TABLE template_review_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY template_review_queue_select ON template_review_queue
  FOR SELECT USING (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );
