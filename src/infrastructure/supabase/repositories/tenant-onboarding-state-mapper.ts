// WONB-001: snake-case row <-> domain entity for tenant_onboarding_state.
// Checklist is persisted as JSONB so we round-trip the literal shape.

import {
  TenantOnboardingState,
  type TenantOnboardingStateProps,
} from '@/domain/entities/onboarding/tenant-onboarding-state'
import type { OnboardingPath } from '@/domain/value-objects/onboarding-path'
import type { OnboardingPhase } from '@/domain/value-objects/onboarding-phase'
import type { PreKickoffChecklist } from '@/domain/value-objects/pre-kickoff-checklist'

export interface TenantOnboardingStateRow {
  id: string
  restaurant_id: string
  onboarding_path: OnboardingPath | null
  phase: OnboardingPhase
  pre_kickoff_checklist: PreKickoffChecklist
  advanced_at: string | null
  advanced_by: string | null
  created_at: string
  updated_at: string
}

export function toEntity(row: TenantOnboardingStateRow): TenantOnboardingState {
  const props: TenantOnboardingStateProps = {
    id: row.id,
    restaurantId: row.restaurant_id,
    onboardingPath: row.onboarding_path,
    phase: row.phase,
    checklist: row.pre_kickoff_checklist,
    advancedAt: row.advanced_at,
    advancedBy: row.advanced_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
  return TenantOnboardingState.fromProps(props)
}

export function toInsertRow(
  e: TenantOnboardingState
): TenantOnboardingStateRow {
  const s = e.snapshot
  return {
    id: s.id,
    restaurant_id: s.restaurantId,
    onboarding_path: s.onboardingPath,
    phase: s.phase,
    pre_kickoff_checklist: s.checklist,
    advanced_at: s.advancedAt,
    advanced_by: s.advancedBy,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  }
}

export interface TenantOnboardingStateUpdate {
  onboarding_path: OnboardingPath | null
  phase: OnboardingPhase
  pre_kickoff_checklist: PreKickoffChecklist
  advanced_at: string | null
  advanced_by: string | null
  updated_at: string
}

export function toUpdateRow(
  e: TenantOnboardingState
): TenantOnboardingStateUpdate {
  const s = e.snapshot
  return {
    onboarding_path: s.onboardingPath,
    phase: s.phase,
    pre_kickoff_checklist: s.checklist,
    advanced_at: s.advancedAt,
    advanced_by: s.advancedBy,
    updated_at: s.updatedAt,
  }
}
