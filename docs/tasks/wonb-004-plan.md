# WONB-004 — Contact import wizard

**Branch:** `feature/wonb-004` · **Migration slot:** `048_import_batch.sql`
**Playbook ref:** `docs/playbooks/staff-number-onboarding-and-marketing.md` §6.1
**Estimate:** 4d · **Depends on:** WONB-005 (✅ merged on develop)

## Goal
Replace ad-hoc CSV imports with a wizard that REFUSES batches lacking per-batch metadata. Auto-grades each row into `strong | medium | weak | none` per playbook §6.1. Persists `import_batch` row + N `consent_records` rows + N `members` rows. Wizard accessible from Members page → "Import contacts".

## Locked decisions (user-approved)
| # | Decision |
|---|---|
| Q-A1 | Reuse `members` table — paper-list shells are members with weak/none consent. |
| Q-A2 | Wrap `importMembersWithConsent` (keep loose fn for tests). New use case `importContactsBatch(batch)`. |
| Q-A4 | `service_only` channel = utility templates allowed, never marketing. Grade = weak. |
| Q-A5 | `proof_url` required when `consent_channel='whatsapp'` (DB CHECK) — covers grade=strong + the medium-degraded-from-whatsapp case. Required-for-strong-only intent achieved at the channel-input step. |
| Q-A6 | Private bucket `consent-proof`, 10MB, jpg/png/webp/pdf, signed URL only. Persist storage path; mint short-lived signed URL on demand via `resolveProofSignedUrl(path)`. |
| Q-B | Auto-grading decision table (encoded in `gradeConsent` pure function): see §"Domain — grading" below. |
| Q-B2 | One wizard, no separate service-only tab. |
| Q-J-adjacent | Tenant-manager can run; platform-admin can run for any tenant. |
| Misc | CSV only for MVP (no Excel). 50,000 rows max per batch. |

## Acceptance criteria
1. CSV upload UI requires per-batch metadata before submit: `source` (text), `date_range_start`, `date_range_end`, `consent_text_shown` (≥10 chars), `consent_channel` (enum), `proof_file_url` (required if channel=`whatsapp`).
2. `gradeConsent` pure function classifies each row's grade per Q-B decision table.
3. Persists one `import_batch` row + N `consent_records` rows + 0..N `members` rows per submission.
4. Preview screen shows per-row grade breakdown before commit ("212 rows: 50 strong, 100 medium, 62 weak, 0 none").
5. Empty CSV rejected with clear error.
6. Duplicate phone within batch rejected (one row per phone per batch).
7. Phone already in `members`: `merge` toggle:
   - `merge=false` (default): rejected with `phone_already_member`.
   - `merge=true`: skip member insert, write new consent_record. Existing `idx_consent_active_uniq` partial unique rejects duplicate active consent (reported as `duplicate_active`).
8. `events.type='consent_imported'` row per imported row, `data_json={ importBatchId, grade, channel, source }`.
9. Wizard accessible from Members page → "Import contacts" button.
10. Concurrent imports for same tenant must not corrupt — repo-level concurrent insert tests.
11. Tenant-manager role can run; platform-admin can run for any tenant.
12. All existing import paths unchanged (`importMembersWithConsent` untouched).

## Auto-grading decision table (Q-B)

| `consent_channel` | `date_range_end >= today − 12mo` | `date_range_end >= today − 24mo` | `consent_text_shown` mentions "WhatsApp" (case-insensitive) | **Grade** |
|---|---|---|---|---|
| `whatsapp` | yes | yes | yes | **strong** |
| `whatsapp` | no | yes | yes | medium |
| `whatsapp` | * | no | * | none |
| `whatsapp` | * | * | no | medium |
| `generic` | yes | yes | * | medium |
| `generic` | no | yes | * | weak |
| `generic` | * | no | * | none |
| `service_only` | * | * | * | weak |
| `none` | * | * | * | none |

Encoded as a pure function (`gradeConsent(input): ConsentGrade`) — TDD parametric test mirrors this table row-for-row.

## Database — `048_import_batch.sql`

```sql
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
```

## Layers & file plan

### Domain — grading
- `src/domain/services/grade-consent-batch.ts` — pure `gradeConsent({channel, consentTextShown, dateRangeEnd, now}): ConsentGrade`. Hard-codes the Q-B decision table. ≤50 LoC.
- `src/domain/services/__tests__/grade-consent-batch.test.ts` — table-driven test against every row of Q-B (9+ cases).

### Domain — entities & VOs
- `src/domain/value-objects/consent-channel.ts` — `'whatsapp' | 'generic' | 'service_only' | 'none'` + `isConsentChannel`, `CONSENT_CHANNELS` array.
- `src/domain/entities/import-batch.ts` — entity with private constructor + static factory `ImportBatch.create(input)`. Validation: `source` non-empty; `consentTextShown` ≥10 chars; `dateRangeEnd >= dateRangeStart`; `dateRangeEnd <= today`; if `channel='whatsapp'` then `proofUrl` required. Throws typed errors (`ImportBatchValidationError`).
- `src/domain/repositories/import-batch-repository.ts` — interface (`insertBatch`, `findByRestaurant`).
- `src/domain/services/__errors__/import-errors.ts` — typed errors: `ImportBatchValidationError`, `ImportRowRejectError({reason, phone})`. Reasons: `phone_already_member`, `duplicate_phone_in_batch`, `duplicate_active`, `invalid_phone`.

### Application
- `src/application/import-contacts-batch.ts` — orchestrator (~80 LoC). Loads batch metadata, computes batch-level grade, fans out to row inserter, writes import_batch at end with breakdown counts.
- `src/application/import-contacts-batch-validation.ts` — pure metadata + row pre-flight validation (~50 LoC).
- `src/application/import-contacts-batch-row.ts` — single-row insertion (member if not exists, consent_record always, event). ~80 LoC.

### Infrastructure
- `src/infrastructure/supabase/repositories/import-batch-repository.ts` — service-role client only.
- `src/infrastructure/supabase/repositories/import-batch-mapper.ts` — snake↔camel.
- `src/infrastructure/supabase/storage/consent-proof-upload.ts` — uploads to `consent-proof` bucket, returns `{ storagePath, signedUrl }`. Mime/size validation here.
- `src/infrastructure/supabase/storage/resolve-proof-signed-url.ts` — `resolveProofSignedUrl(storagePath: string): Promise<string>` — 5-minute signed URL. Used by future renderers.

### API routes
| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/dashboard/imports/proof-upload` | POST | tenant-manager | Upload single proof file; returns `{ storagePath, signedUrl }` |
| `/api/dashboard/imports/preview` | POST | tenant-manager | Parse uploaded CSV + batch meta; returns `{ rows[], gradeBreakdown }` without persisting |
| `/api/dashboard/imports` | POST | tenant-manager | Commit the batch; returns `{ importBatchId, inserted, rejected }` |
| `/api/dashboard/imports` | GET | tenant-manager | List recent batches (last 50) |

CSV parsing via `papaparse` (add to `package.json` if not present). Server-side. Stream uploads.

Auth: existing tenant-scoped guard pattern. Platform-admin allowed via the same guard.

### UI
- `src/app/dashboard/members/import/page.tsx` — wizard shell with 4 steps, URL-state survives reload.
- `src/components/dashboard/import-wizard/step-batch-meta.tsx` — Step 1 form with all metadata fields. Validation matches AC #1.
- `src/components/dashboard/import-wizard/step-upload-csv.tsx` — Step 2 file picker + parse preview.
- `src/components/dashboard/import-wizard/step-grade-preview.tsx` — Step 3 grade breakdown chart + per-row table (paginated; virtual scroll for >1k rows).
- `src/components/dashboard/import-wizard/step-confirm.tsx` — Step 4 final commit + result summary.
- `src/components/dashboard/import-wizard/proof-uploader.tsx` — wraps `/proof-upload` API.
- `src/components/dashboard/import-wizard/grade-badge.tsx` — colored chip.
- `src/hooks/use-import-batch.ts` — SWR-style hook over the 4 endpoints.
- Modify `src/app/dashboard/members/page.tsx` — add "Import contacts" button.

### i18n (en + zh-HK)
Namespace `importWizard.*` per architect's plan. EN strings verbatim from playbook §6.1; zh-HK translated by frontend dev inline.

### Storage
- `supabase/storage/seed-consent-proof-bucket.md` — manual seed doc (Supabase storage buckets are typically created via dashboard or CLI, not SQL). Documents bucket name, RLS, mime allowlist, max size.

## Test plan (TDD strictly)

| Layer | Test |
|---|---|
| Domain pure | `grade-consent-batch.test.ts` — 9-row parametric table from Q-B |
| Domain entity | `import-batch.test.ts` — `create()` rejects: empty source / short text / future date / invalid date order / whatsapp without proof |
| Domain VO | `consent-channel.test.ts` — `isConsentChannel` accepts 4 values |
| Use case | `import-contacts-batch.test.ts` — happy path; phone already member without merge → reject; with merge → consent insert; duplicate within batch → reject; auto-grading per row; gradeBreakdown counts; concurrent imports produce 2 separate batch rows |
| Repository | `import-batch-repository.test.ts` — insert + select; RLS denies cross-tenant |
| Storage | `consent-proof-upload.test.ts` — mime/size validation; signed-URL minted |
| API contract | `imports/preview` returns rows + breakdown without DB writes; `imports` POST 200 + result; missing meta → 400; invalid mime → 400; auth: 401 / 403 / 200 |
| UI | `step-batch-meta.test.tsx` — required-field validation; submit disabled until valid; `step-grade-preview.test.tsx` — breakdown badges; `use-import-batch.test.ts` — preview + commit flows mocked |
| Edge cases | 0-row CSV → reject; 50k-row CSV → success in <30s; >10MB proof → reject; future date_range_end → 400; merge=true with active consent → row reported `duplicate_active` |

## Independent work streams (parallel sub-agents)

| Stream | Owner | Scope |
|---|---|---|
| **A — Migration + Domain + Use Case + Repo** (~1.5d) | senior-backend-dev | Migration 048, `gradeConsent` pure fn, `ImportBatch` entity, errors, use case, validation, row inserter, repo + mapper. All tests for these. |
| **B — Proof upload route + storage adapter** (~0.5d) | senior-backend-dev | `consent-proof-upload.ts`, `resolve-proof-signed-url.ts`, `/api/dashboard/imports/proof-upload/route.ts` + tests. Bucket seed doc. Independent of A. |
| **C — Import API routes** (~0.5d) | senior-backend-dev | `/api/dashboard/imports/{preview,POST,GET}/route.ts` + tests. **Depends on A.** Uses use case from Stream A. |
| **D — Wizard UI** (~1.5d) | react-frontend-dev | All 4 steps + 3 helper components + hook + tab wiring + i18n. Mocks API contract until C lands; integrates after. |

A + B + D run in parallel after plan approval. C runs after A. Synthesis: replace D's mocked hook calls with real API calls.

## Out of scope (other backlog items)
- **Excel parsing** — CSV only for MVP.
- **Bulk grade override by admin** — auto-graded only; manual override is a follow-up.
- **Source-to-template suggestions** — manual today.
- **Stale-consent expiry sweep** → WONB-009 (post-launch).
- **Right-to-erasure / tombstones** → WONB-014 (post-launch).
- **QR PDF generator** → WONB-006 (post-launch).
- **Inbound-first opt-in flow** → WONB-007 (separate task).
- **Re-confirmation campaign mode** → WONB-008 (separate task).
