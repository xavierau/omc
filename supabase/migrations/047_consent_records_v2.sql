-- WONB-005: extend consent_records for grading + audit + expiry.
--
-- Schema delta (additive only, fully backward-compatible):
--   1. Widen consent_grade CHECK from 2 values (strong/weak) to 4 (strong/medium/weak/none).
--   2. Add proof_url (private storage URL), consent_text_shown (verbatim wording),
--      expires_at (default captured_at + 24mo via INSERT trigger).
--   3. Backfill expires_at for existing rows (38's backfill seeded captured_at).
--   4. Partial index for the WONB-009 expiry sweep (post-launch).
--   5. Extend events.type CHECK with 4 new audit types.
--
-- All new columns are nullable so existing INSERT paths continue without modification.

-- 1. Widen consent_grade CHECK
ALTER TABLE consent_records DROP CONSTRAINT IF EXISTS consent_records_consent_grade_check;
ALTER TABLE consent_records ADD CONSTRAINT consent_records_consent_grade_check
  CHECK (consent_grade IN ('strong', 'medium', 'weak', 'none'));

-- 2. New columns
ALTER TABLE consent_records
  ADD COLUMN proof_url TEXT,
  ADD COLUMN consent_text_shown TEXT,
  ADD COLUMN expires_at TIMESTAMPTZ,
  ADD COLUMN granted_at TIMESTAMPTZ;

COMMENT ON COLUMN consent_records.proof_url IS
  'Private Supabase Storage signed URL of paper form / screenshot. Required for grade=strong (enforced in application layer, not DB).';
COMMENT ON COLUMN consent_records.consent_text_shown IS
  'Verbatim text the customer was shown at consent time. Longer-form than business_name_shown, used for audit defence.';
COMMENT ON COLUMN consent_records.expires_at IS
  'Default captured_at + 24 months via trigger. WONB-009 (post-launch) demotes records past expiry to grade=none, status=pending.';
COMMENT ON COLUMN consent_records.granted_at IS
  'Explicit moment a pending row was promoted to opted_in (set by upgradeToOptedIn repo method). Distinct from captured_at (proof intake) and updated_at (any touch). NULL for rows that have never been opted_in or that pre-date this column. Required for WONB-007/008 consent-flip analytics.';

-- 3. Default expires_at = captured_at + 24mo when NULL on insert
CREATE OR REPLACE FUNCTION consent_records_default_expires_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.expires_at IS NULL THEN
    NEW.expires_at := NEW.captured_at + interval '24 months';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_consent_records_default_expires_at ON consent_records;
CREATE TRIGGER trg_consent_records_default_expires_at
  BEFORE INSERT ON consent_records
  FOR EACH ROW EXECUTE FUNCTION consent_records_default_expires_at();

-- 4. Backfill expires_at for existing rows
UPDATE consent_records
   SET expires_at = captured_at + interval '24 months'
 WHERE expires_at IS NULL;

-- 5. Partial index for WONB-009 expiry sweep
CREATE INDEX idx_consent_records_expires_active
  ON consent_records(expires_at)
  WHERE status IN ('opted_in', 'pending');

-- 6. Extend events.type CHECK
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_type_check;
ALTER TABLE events ADD CONSTRAINT events_type_check
  CHECK (type IN (
    'join', 'redeem', 'receipt', 'campaign', 'points',
    'unsubscribe', 'reward_redeem',
    'pos_transaction', 'pos_refund', 'pos_customer_link',
    'integration_error',
    'whatsapp_error',
    'onboarding_phase_advanced',
    'consent_imported',
    'consent_granted',
    'consent_revoked',
    'consent_expired'
  ));
