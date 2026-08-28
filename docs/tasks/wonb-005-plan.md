# WONB-005 — Extend `consent_records` schema

**Branch:** `feature/wonb-005` · **Migration slot:** `047_consent_records_v2.sql`
**Playbook ref:** `docs/playbooks/staff-number-onboarding-and-marketing.md` §6.1, §6.5
**Estimate:** 1d · **Foundation for WONB-004 / WONB-007 / WONB-008**

## Goal
Extend `consent_records` to support 4-level grading + audit + expiry. Foundation only — no application logic, no UI. The grading rules, import wizard, opt-in flow, and re-confirmation campaign all consume this schema in subsequent WONB tasks.

## Locked decisions (user-approved)
| # | Decision |
|---|---|
| Q-A1 | Reuse `members` — no separate `contacts` table. Members carry consent_records that determine marketability. |
| Q-A3 | Every grade gets `expires_at = captured_at + 24mo` via DB trigger (not just strong/medium). |
| Q-A4 | `service_only` channel allows utility templates + 24h-window replies; never marketing. Operationally no code change to utility path; channel value records why no marketing consent exists. Grade = weak. |
| Q-A5 | `proof_url` required for grade=`strong` only. Enforced in **application layer** (WONB-004 wizard), NOT a DB CHECK — multiple sources of strong consent (e.g. `whatsapp_join_keyword`) have no paper proof. |
| Q-L | 4 new `events.type` values: `consent_imported`, `consent_granted`, `consent_revoked`, `consent_expired`. Grade lives in `data_json`. |
| Q-M | Add `upgradeToOptedIn(args)` repo method for idempotent YES handling in WONB-007/008. |
| Q-N | All existing 8 consent_records consumers stay backward-compatible — new columns nullable. |
| Q-K | Forward-compat with WONB-014 right-to-erasure: no schema change needed; tombstone table will reference `phone_e164_hash`, not `consent_records.id`. |

## Acceptance criteria

1. Migration `047_consent_records_v2.sql` (a) widens `consent_grade` CHECK from 2 to 4 values, (b) adds `proof_url`, `consent_text_shown`, `expires_at` columns (all nullable), (c) installs an INSERT trigger defaulting `expires_at = captured_at + interval '24 months'` when NULL, (d) backfills `expires_at` for existing rows, (e) creates partial index `idx_consent_records_expires_active` on `expires_at WHERE status IN ('opted_in','pending')`, (f) extends `events.type` CHECK with 4 new types.
2. `ConsentGrade` value object widens to `'strong' | 'medium' | 'weak' | 'none'`. `GRADES` array updated. `isConsentGrade` accepts all 4.
3. `ConsentRecord` entity adds 3 new optional props (`proofUrl`, `consentTextShown`, `expiresAt`). `grant()` and `markPending()` accept them as defaulted-NULL parameters. Snapshot exposes them. `revoke()` preserves them.
4. `ConsentRecordMapper` round-trips the new columns (toEntity / toRow / toUpdateRow as applicable).
5. Repository gets a new method `upgradeToOptedIn(args: { restaurantId; phoneE164; category })`:
   - Returns `true` if a `pending` row was upgraded to `opted_in`.
   - Returns `false` if no `pending` row exists.
   - Idempotent: if a row is already `opted_in`, returns `false` (does NOT throw).
   - Implementation: single SQL `UPDATE consent_records SET status='opted_in', granted_at=now() WHERE restaurant_id=$1 AND phone_e164=$2 AND category=$3 AND status='pending' RETURNING id` and check affected rows.
6. **All existing tests pass unchanged.** New columns are nullable; existing callers (`join-consent.ts`, `import-members-with-consent.ts`, `member-handlers.ts::handleUnsubscribe`, etc.) write NULL and continue working.
7. Migration is forward-only (matches 038/039/045/046 posture). No reverse migration needed.

## Database — `047_consent_records_v2.sql`

```sql
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
  ADD COLUMN expires_at TIMESTAMPTZ;

COMMENT ON COLUMN consent_records.proof_url IS
  'Private Supabase Storage signed URL of paper form / screenshot. Required for grade=strong (enforced in application layer, not DB).';
COMMENT ON COLUMN consent_records.consent_text_shown IS
  'Verbatim text the customer was shown at consent time. Longer-form than business_name_shown, used for audit defence.';
COMMENT ON COLUMN consent_records.expires_at IS
  'Default captured_at + 24 months via trigger. WONB-009 (post-launch) demotes records past expiry to grade=none, status=pending.';

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
```

## Files to create / modify

### Create
- `supabase/migrations/047_consent_records_v2.sql`

### Modify (with co-located tests)
- `src/domain/value-objects/consent-status.ts` — widen `ConsentGrade` to 4 values
- `src/domain/entities/consent-record.ts` — add 3 new props, update factories
- `src/domain/repositories/consent-record-repository.ts` — interface adds `upgradeToOptedIn`
- `src/infrastructure/supabase/repositories/consent-record-mapper.ts` — round-trip new columns
- `src/infrastructure/supabase/repositories/consent-record-repository.ts` — implement `upgradeToOptedIn`

## Test plan
TDD strictly. Write each failing test first.

| Layer | Test file | New cases |
|---|---|---|
| Domain VO | `src/domain/value-objects/__tests__/consent-status.test.ts` | `isConsentGrade('medium')` true; `isConsentGrade('none')` true; `GRADES` length 4 |
| Domain entity | `src/domain/entities/__tests__/consent-record.test.ts` | `grant({proofUrl, consentTextShown, expiresAt})` populates fields; defaults NULL; `revoke()` preserves new fields; `markPending` accepts new fields |
| Mapper | `src/infrastructure/supabase/repositories/__tests__/consent-record-mapper.test.ts` (or co-located) | toRow includes new columns; toEntity reads new columns; null values round-trip |
| Repository | `src/infrastructure/supabase/repositories/__tests__/consent-record-repository.test.ts` | `upgradeToOptedIn` (a) returns true + status='opted_in' when pending row exists, (b) returns false when only opted_in row exists (idempotent), (c) returns false when no row exists, (d) only matches by (restaurantId, phoneE164, category) |
| Existing tests | All current consent-record tests | Pass unchanged (no modifications expected) |

## Out of scope (other backlog items)
- Auto-grading function (consumes schema) → **WONB-004**
- Inbound-first opt-in flow (uses `upgradeToOptedIn`) → **WONB-007**
- Re-confirmation campaign mode → **WONB-008**
- Stale-consent expiry sweep → **WONB-009** (post-launch)
- Right-to-erasure tombstones → **WONB-014** (post-launch)
- `consent-proof` Supabase Storage bucket creation → **WONB-004** (the wizard owns the upload path)
