// WONB-001: POST /api/admin/tenants/[id]/onboarding/advance
// Optimistic-locked phase advance. Audit: onboarding.phase.advance.
// Best-effort event emit (onboarding_phase_advanced) — failures logged.

import { NextRequest, NextResponse } from 'next/server'
import { advancePhase } from '@/application/onboarding/advance-phase'
import { getOnboardingState } from '@/application/onboarding/get-onboarding-state'
import { tenantOnboardingStateRepository } from '@/infrastructure/supabase/repositories/tenant-onboarding-state-repository'
import { kpiGateEvaluator } from '@/infrastructure/supabase/onboarding/kpi-gate-evaluator-supabase'
import { logAdminAction, extractIp } from '@/infrastructure/supabase/audit-logger'
import { createEvent } from '@/infrastructure/supabase/repositories/event-repository'
import type { AdvancePhaseResult } from '@/application/onboarding/advance-phase'
import { gate, ensureValidId, handleError } from '../_shared'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const outcome = await gate()
  if (outcome.kind === 'response') return outcome.response
  const { id } = await params
  const idError = ensureValidId(id)
  if (idError) return idError
  try {
    const result = await advancePhase({
      restaurantId: id,
      actor: outcome.gate.userId,
      repo: tenantOnboardingStateRepository,
      kpiEvaluator: kpiGateEvaluator,
    })
    logAdvanceAudit(outcome.gate.userId, id, result, extractIp(request))
    await tryEmitAdvanceEvent(id, result)
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

function logAdvanceAudit(
  userId: string,
  id: string,
  result: AdvancePhaseResult,
  ip: string
): void {
  logAdminAction({
    userId,
    action: 'onboarding.phase.advance',
    resourceType: 'tenant',
    resourceId: id,
    details: {
      from: result.fromPhase,
      to: result.toPhase,
      kpiGate: result.kpiGate.status,
    },
    ipAddress: ip,
  })
}

async function tryEmitAdvanceEvent(
  id: string,
  result: AdvancePhaseResult
): Promise<void> {
  try {
    await createEvent({
      restaurantId: id,
      memberId: null,
      type: 'onboarding_phase_advanced',
      dataJson: { from: result.fromPhase, to: result.toPhase },
      source: 'admin.onboarding',
    })
  } catch (err) {
    console.warn(
      'onboarding.phase.advance event emit failed:',
      err instanceof Error ? err.message : err
    )
  }
}
