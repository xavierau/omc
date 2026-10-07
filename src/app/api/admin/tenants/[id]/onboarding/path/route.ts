// WONB-001: PATCH /api/admin/tenants/[id]/onboarding/path
// Sets the onboarding path while phase=setup. Audit: onboarding.path.set.

import { NextRequest, NextResponse } from 'next/server'
import { setOnboardingPath } from '@/application/onboarding/set-onboarding-path'
import { getOnboardingState } from '@/application/onboarding/get-onboarding-state'
import { tenantOnboardingStateRepository } from '@/infrastructure/supabase/repositories/tenant-onboarding-state-repository'
import { kpiGateEvaluator } from '@/infrastructure/supabase/onboarding/kpi-gate-evaluator-supabase'
import { logAdminAction, extractIp } from '@/infrastructure/supabase/audit-logger'
import { validatePath } from '@/infrastructure/validation/onboarding-validators'
import { gate, ensureValidId, handleError } from '../_shared'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const outcome = await gate()
  if (outcome.kind === 'response') return outcome.response
  const { id } = await params
  const idError = ensureValidId(id)
  if (idError) return idError
  try {
    const body = await request.json()
    const path = validatePath(body?.path)
    await setOnboardingPath({
      restaurantId: id,
      path,
      repo: tenantOnboardingStateRepository,
    })
    logAdminAction({
      userId: outcome.gate.userId,
      action: 'onboarding.path.set',
      resourceType: 'tenant',
      resourceId: id,
      details: { path },
      ipAddress: extractIp(request),
    })
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
