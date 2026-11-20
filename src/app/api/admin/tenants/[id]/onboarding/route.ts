// WONB-001: GET /api/admin/tenants/[id]/onboarding
// Auto-initializes a default row when none exists (Q1). Platform-admin only.

import { NextRequest, NextResponse } from 'next/server'
import { getOnboardingState } from '@/application/onboarding/get-onboarding-state'
import { tenantOnboardingStateRepository } from '@/infrastructure/supabase/repositories/tenant-onboarding-state-repository'
import { kpiGateEvaluator } from '@/infrastructure/supabase/onboarding/kpi-gate-evaluator-supabase'
import { gate, ensureValidId, handleError } from './_shared'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const outcome = await gate()
  if (outcome.kind === 'response') return outcome.response
  const { id } = await params
  const idError = ensureValidId(id)
  if (idError) return idError
  try {
    const view = await getOnboardingState({
      restaurantId: id,
      repo: tenantOnboardingStateRepository,
      kpiEvaluator: kpiGateEvaluator,
    })
    return NextResponse.json(view)
  } catch (error) {
    return handleError(error)
  }
}
