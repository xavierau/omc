-- WONB-001: per-tenant onboarding state machine.
-- Phase throttles broadcast aggressiveness (see playbook §1, §2.1). Advance
-- requires (a) all six pre-kickoff checklist items checked for setup→probe
-- and (b) a KPI gate over `whatsapp_messages` for every transition.
--
-- Writer: SOLE writer is the service-role client at
--   src/infrastructure/supabase/repositories/tenant-onboarding-state-repository.ts
-- which bypasses RLS. The SELECT policy below is for tenant dashboards and
-- platform-admin read access only — there are intentionally no INSERT or
-- UPDATE policies (browser-side writes are not supported). Mirrors the
-- posture of `tenant_quality_state` (039) and `consent_records` (038).
--
-- events.type CHECK note: `events.type` has an exhaustive CHECK list (see
-- 001/020/021/037). The current set is
--   join, redeem, receipt, campaign, points, unsubscribe, reward_redeem,
--   pos_transaction, pos_refund, pos_customer_link,
--   integration_error, whatsapp_error.
-- Append `onboarding_phase_advanced` here so the application layer (Stream
-- C) can persist phase advances into the events stream alongside admin
-- audit logs.

CREATE TABLE tenant_onboarding_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL UNIQUE
    REFERENCES restaurants(id) ON DELETE CASCADE,
  onboarding_path TEXT
    CHECK (onboarding_path IS NULL OR onboarding_path IN ('A','B1','B2','B3')),
  phase TEXT NOT NULL DEFAULT 'setup'
    CHECK (phase IN ('setup','probe','build','scale','full','steady')),
  pre_kickoff_checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
  advanced_at TIMESTAMPTZ,
  advanced_by UUID,  -- auth.users.id; not FK'd to avoid cross-schema coupling
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tos_advance_pair CHECK (
    (advanced_at IS NULL AND advanced_by IS NULL)
    OR (advanced_at IS NOT NULL AND advanced_by IS NOT NULL)
  ),
  CONSTRAINT tos_phase_requires_path CHECK (
    phase = 'setup' OR onboarding_path IS NOT NULL
  ),
  CONSTRAINT tos_checklist_keys_present CHECK (
    pre_kickoff_checklist ? 'hk_sim_never_used'
    AND pre_kickoff_checklist ? 'verified_meta_business'
    AND pre_kickoff_checklist ? 'display_name_draft_approved'
    AND pre_kickoff_checklist ? 'opt_in_source_documented'
    AND pre_kickoff_checklist ? 'vertical_allowed'
    AND pre_kickoff_checklist ? 'first_three_campaigns_drafted'
  )
);

CREATE UNIQUE INDEX idx_tos_restaurant ON tenant_onboarding_state(restaurant_id);
CREATE INDEX idx_tos_phase ON tenant_onboarding_state(phase);

CREATE TRIGGER set_tenant_onboarding_state_updated_at
  BEFORE UPDATE ON tenant_onboarding_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Forbid mutation of (advanced_at, advanced_by) on a stable phase.
-- Defence-in-depth against a buggy server route writing the advance pair
-- without actually changing `phase` (which would silently corrupt audit).
CREATE OR REPLACE FUNCTION tos_advance_immutability()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.phase = OLD.phase AND (
    NEW.advanced_at IS DISTINCT FROM OLD.advanced_at
    OR NEW.advanced_by IS DISTINCT FROM OLD.advanced_by
  ) THEN
    RAISE EXCEPTION 'tenant_onboarding_state: advanced_at/advanced_by immutable on stable phase';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tos_advance_immutability
  BEFORE UPDATE OF phase, advanced_at, advanced_by ON tenant_onboarding_state
  FOR EACH ROW EXECUTE FUNCTION tos_advance_immutability();

ALTER TABLE tenant_onboarding_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY tos_select ON tenant_onboarding_state
  FOR SELECT USING (
    restaurant_id IN (SELECT user_restaurant_ids()) OR is_platform_admin()
  );
-- Writes via service-role client only. No INSERT/UPDATE/DELETE policies.

-- Extend events.type CHECK to allow `onboarding_phase_advanced`. Mirrors
-- the pattern used in 020, 021, and 037: drop + recreate with the union
-- of previously allowed values plus the new one.
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_type_check;
ALTER TABLE events ADD CONSTRAINT events_type_check
  CHECK (type IN (
    'join', 'redeem', 'receipt', 'campaign', 'points',
    'unsubscribe', 'reward_redeem',
    'pos_transaction', 'pos_refund', 'pos_customer_link',
    'integration_error',
    'whatsapp_error',
    'onboarding_phase_advanced'
  ));
