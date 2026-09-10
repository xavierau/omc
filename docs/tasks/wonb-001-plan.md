# WONB-001 — Tenant Onboarding State Machine

**Branch:** `feature/wonb-001` · **Migration slot:** `046_tenant_onboarding_state.sql`
**Playbook ref:** `docs/playbooks/staff-number-onboarding-and-marketing.md` §1, §2.1

## Goal
Persist a per-tenant onboarding record that drives a Sales→CS→Scale workflow. The phase value throttles how aggressively the tenant can broadcast marketing messages; advancing requires (a) all 6 pre-kickoff checklist items checked **(setup→probe only)** and (b) a KPI gate over `whatsapp_messages` for every transition out of `setup`.

**Audience of UI:** OhMyClient platform-admin/CS staff only. Tenants and members never see this surface.

## Locked decisions (user-approved)
| # | Decision |
|---|---|
| Q1 | `GET /onboarding` auto-creates a default row for any tenant without one |
| Q2 | Only platform-admin role can advance the phase. No tenant self-service |
| Q3 | KPI gate uses **delivery ≥95% and opt-out <2%** only. Block-rate gate is **dropped** in WONB-001; real block ingestion lands in WONB-010 |
| Q4 | Single 6-item checklist (per playbook §2.1). For Path B*, `hk_sim_never_used` is auto-marked `not_applicable` and counts as satisfied |
| Q6 | Frontend dev writes inline zh-HK translations of the 6 labels |
| Q7 | KPI minimum sample size = **100 marketing messages in the prior 7 days**. Below that, gate returns `insufficient` (distinct from pass/fail) |

## Acceptance criteria
1. Migration `046_tenant_onboarding_state.sql` creates `tenant_onboarding_state` per §3 below. Forward-only, no data backfill needed.
2. `InitializeOnboardingState` is idempotent: returns existing row, else creates one with `phase='setup'`, `path=null`, six-item checklist (each `checked=false`).
3. `SetOnboardingPath` succeeds only while `phase='setup'`; rebuilds the checklist (preserving prior ticks for items unaffected by path).
4. `UpdateChecklistItem` ticks/unticks one item by stable key. Tick writes `checked_at` (server now) and `checked_by` (auth user id); untick nulls them. Tick attempts on `not_applicable` items are no-ops.
5. `AdvancePhase` advances by exactly one step in path order (`setup→probe→build→scale→full→steady`) and only when:
   - For `setup→probe`: the checklist is complete AND KPI gate = `pass`.
   - For every other transition: KPI gate = `pass`.
   - Path is set (non-null).
   - Optimistic concurrency: `UPDATE … WHERE phase=$expected`. Loser of a race throws `ConcurrentAdvanceError` → 409.
6. KPI gate states:
   - `insufficient` when total marketing sends in 7d < 100 (UI shows "N of 100 messages observed")
   - `fail` with `failingMetrics: ('delivery'|'opt_out')[]`
   - `pass` when delivery ≥95% AND opt-out <2%
7. `GetOnboardingState` returns a derived view including `kpiGate`, `checklistComplete`, `nextPhase`, `canAdvance`, `blockedReasons[]`. UI never re-derives policy.
8. UI: a new "Onboarding" tab on the platform-admin tenant detail page with path selector, phase indicator, checklist editor, advance button, KPI gate summary. Disabled advance shows reasons via tooltip.
9. All write paths gated by `assertPlatformAdmin()` and write `admin_audit_logs` rows: `onboarding.path.set`, `onboarding.checklist.update`, `onboarding.phase.advance`.
10. Postgres trigger `tos_advance_immutability` rejects rewriting `advanced_at`/`advanced_by` on a stable phase. Defence-in-depth.

## Database — `046_tenant_onboarding_state.sql`

```sql
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

-- Forbid mutation of advance pair on stable phase
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
```

**events.type CHECK:** verify whether the `events.type` column has an exhaustive CHECK list. If yes, fold `'onboarding_phase_advanced'` into 046 alongside the table DDL. If `events.type` is open-string, no extra change.

## KPI gate — reuse 045 RPC, drop block

- **Reuse** `get_quality_kpis_for_tenant(p_restaurant_id, p_since)` from `045_quality_kpi_rpcs.sql`. Do not duplicate.
- Wrap with a domain port `KpiGateEvaluator` that returns `{ status: 'pass'|'fail'|'insufficient', kpis, thresholds, failingMetrics: ('delivery'|'opt_out')[] }`.
- Thresholds (locked): `minDeliveryRate = 0.95`, `maxOptOutRate = 0.02`, `minSampleSize = 100`.
- 7d window is hard-coded for WONB-001 (not configurable from UI).

## Layers & file plan

### Domain (`src/domain/`)
- `value-objects/onboarding-path.ts` — `'A'|'B1'|'B2'|'B3'` + `isOnboardingPath`
- `value-objects/onboarding-phase.ts` — `'setup'|'probe'|'build'|'scale'|'full'|'steady'` + `nextPhase(path, current)`, `isAdvanceLegal`
- `value-objects/pre-kickoff-checklist.ts` — frozen 6-item shape, `buildInitialChecklist(path)`, `applyTick`, `applyUntick`, `isChecklistComplete`. Path-B variants auto-N/A `hk_sim_never_used`.
- `value-objects/kpi-thresholds.ts` — constants for the gate
- `entities/onboarding/tenant-onboarding-state.ts` — entity with private constructor + static factories (mirrors `quality-state-event.ts`)
- `repositories/tenant-onboarding-state-repository.ts` — interface
- `ports/kpi-gate-evaluator.ts` — interface
- `services/__errors__/onboarding-errors.ts` — typed errors: `OnboardingAdvanceError(reason)`, `ConcurrentAdvanceError`, `OnboardingPathLockedError`, `OnboardingTerminalError`, `OnboardingPathRequiredError`

### Application (`src/application/onboarding/`)
- `initialize-onboarding-state.ts`
- `set-onboarding-path.ts`
- `update-checklist-item.ts`
- `advance-phase.ts`
- `get-onboarding-state.ts`

### Infrastructure
- `src/infrastructure/supabase/repositories/tenant-onboarding-state-repository.ts` — service-role client only
- `src/infrastructure/supabase/repositories/tenant-onboarding-state-mapper.ts` — snake↔camel + JSONB shape
- `src/infrastructure/supabase/onboarding/kpi-gate-evaluator-supabase.ts` — wraps `get_quality_kpis_for_tenant`
- `src/infrastructure/validation/onboarding-validators.ts` — `validateChecklistKey`, `validatePath`

### API (Next.js app router)
- `src/app/api/admin/tenants/[id]/onboarding/route.ts` — GET (auto-init)
- `src/app/api/admin/tenants/[id]/onboarding/path/route.ts` — PATCH `{ path }`
- `src/app/api/admin/tenants/[id]/onboarding/checklist/route.ts` — PATCH `{ key, checked }`
- `src/app/api/admin/tenants/[id]/onboarding/advance/route.ts` — POST

Each route follows the existing pattern: `assertPlatformAdmin()` → `checkAdminRateLimit()` → use case → `logAdminAction()` → `handleError()`. Reference: `src/app/api/admin/tenants/[id]/plan/route.ts`.

Error → status mapping:
- `OnboardingAdvanceError({reason})` → 409 with `{ error, reason: 'checklist_incomplete'|'kpi_failed'|'kpi_insufficient'|'phase_terminal'|'illegal_transition'|'no_path' }`
- `ConcurrentAdvanceError` → 409 `{ reason: 'concurrent_advance' }`
- `OnboardingPathLockedError` → 409 `{ reason: 'phase_locked' }`
- `ValidationError` → 400; auth → 401/403

### UI (`src/components/admin/onboarding/`)
- `onboarding-tab.tsx` — container, ≤120 LoC
- `onboarding-path-selector.tsx` — RadioGroup A/B1/B2/B3, disabled when phase ≠ setup
- `onboarding-phase-indicator.tsx` — stepper
- `checklist-editor.tsx` — six rows; `not_applicable` greyed
- `advance-phase-button.tsx` — disabled tooltip shows `blockedReasons`
- `kpi-gate-summary.tsx` — delivery + opt-out tiles (no block tile in WONB-001)

Tab wired into `src/app/admin/(dashboard)/tenants/[id]/page.tsx` between existing `metrics` and `campaigns` tabs.

### Hook
- `src/hooks/use-admin-tenant-onboarding.ts` — SWR over `/api/admin/tenants/[id]/onboarding`

### i18n
- `src/i18n/messages/en.json` and `zh-HK.json` — `admin.onboarding.*` namespace: 6 checklist labels, phase names, gate failure reasons, blocked-reason copy. EN strings verbatim from playbook §2.1. zh-HK translations written by frontend dev.

### Test files (~17)
Per layer's `__tests__/` folder. Coverage table in §8 of the architect's full plan; TL;DR:
- Domain VO tests for `onboarding-path`, `onboarding-phase`, `pre-kickoff-checklist`
- Entity tests for `tenant-onboarding-state` (each invariant, each error path)
- Application use case tests with mocked ports
- Repository integration test (CRUD + RLS + trigger + optimistic concurrency)
- KPI gate evaluator test (pass / fail / insufficient permutations; 045 RPC mocked)
- API contract tests per route (auth, validation, error mapping)
- UI component tests for `checklist-editor`, `advance-phase-button`, `onboarding-tab`

## Independent work streams

| Stream | Owner | Scope |
|---|---|---|
| **A — Domain + Migration + Repo + KPI eval** | senior-backend-dev | All `src/domain/`, `046_tenant_onboarding_state.sql`, `tenant-onboarding-state-repository.ts`, mapper, `kpi-gate-evaluator-supabase.ts`. Tests for all of the above. |
| **B — UI shell + i18n + hook stub** | react-frontend-dev | All `src/components/admin/onboarding/`, hook stub returning a fixture `OnboardingStateView`, tab wiring in `tenants/[id]/page.tsx`, `admin.onboarding.*` i18n namespace EN + zh-HK. UI tests against fixture. |
| **C — Use cases + API routes (depends on A)** | senior-backend-dev | All `src/application/onboarding/`, four API routes, validators, audit log calls. Application + API tests. Replace Stream B's hook fixture with the real fetch. |

A and B run in parallel. C runs after A's interfaces land.

## Out of scope (deferred to other backlog items)
- WONB-002 — daily Meta sync of display name + verification
- WONB-003 — Coexistence (B1) wizard
- WONB-004 / 005 — contact import wizard, extended consent_records
- WONB-006 / 007 / 008 — QR opt-in PDF, inbound-first opt-in, re-confirmation campaign
- WONB-010 — block-reason ingestion (we drop block from the gate until this lands)
- WONB-015 — incident timeline / per-phase history (we store only current phase + last advance)
- Phase regressions / auto-revert on quality drop (auto-pause is WAQ-009, runs independently)
- Tenant self-service advance / public UI
- Cron jobs / Slack notifications on phase advance
