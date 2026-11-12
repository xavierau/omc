// WONB-001: PATCH /api/admin/tenants/[id]/onboarding/checklist
// Tick / untick a single checklist item. Audit: onboarding.checklist.update.

import { NextRequest, NextResponse } from 'next/server'
import { updateChecklistItem } from '@/application/onboarding/update-checklist-item'
import { getOnboardingState } from '@/application/onboarding/get-onboarding-state'
import { tenantOnboardingStateRepository } from '@/infrastructure/supabase/repositories/tenant-onboarding-state-repository'
import { kpiGateEvaluator } from '@/infrastructure/supabase/onboarding/kpi-gate-evaluator-supabase'
import { logAdminAction, extractIp } from '@/infrastructure/supabase/audit-logger'
import { validateChecklistKey } from '@/infrastructure/validation/onboarding-validators'
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
    const { key, checked } = validateChecklistKey(body)
    await updateChecklistItem({
      restaurantId: id,
      key,
      checked,
      actor: outcome.gate.userId,
      repo: tenantOnboardingStateRepository,
    })
    logAdminAction({
      userId: outcome.gate.userId,
      action: 'onboarding.checklist.update',
      resourceType: 'tenant',
      resourceId: id,
      details: { key, checked },
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
