// INT-001 WI-3: GET /api/integrations/{integrationId}/members/jobs/{jobId}
// (spec US-2). Signed, empty body (T-H2's GET variant: `digest` is the
// jobId itself, not a body hash). T-H4: `getMemberJob` is scoped by BOTH
// ids at the repository layer, so an unknown OR foreign job id produce the
// SAME 404 body from this route -- never a 403, never an enumeration
// signal.

import { NextRequest, NextResponse } from 'next/server'
import { extractIp } from '@/infrastructure/supabase/audit-logger'
import { authenticateIntegrationV2 } from '../../../verify-signature-v2'
import { authErrorResponse } from '../../../inbound-auth-response'
import { DEFAULT_PARTNER_BURST, DEFAULT_PARTNER_RATE_PER_MIN } from '@/application/integration-inbound-guard'
import { systemClock } from '@/infrastructure/clock/system-clock'
import { findIntegrationSettingsById } from '@/infrastructure/supabase/repositories/integration-settings-repository'
import { getInboundRateLimiter } from '@/infrastructure/queue/integration-inbound-queue'
import { getMemberJob } from '@/application/get-member-job'

interface RouteParams {
  params: Promise<{ integrationId: string; jobId: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { integrationId, jobId } = await params
  const clientIp = extractIp(request)

  const settings = await findIntegrationSettingsById(integrationId).catch(() => null)

  try {
    await authenticateIntegrationV2({
      integrationId,
      kind: 'member.job',
      headers: {
        timestamp: request.headers.get('x-omc-timestamp'),
        nonce: request.headers.get('x-omc-nonce'),
        signature: request.headers.get('x-omc-signature'),
      },
      digest: jobId,
      clientIp,
      rateLimiter: getInboundRateLimiter(),
      clock: systemClock,
      inboundDisabled: process.env.INT001_DISABLE_INBOUND === '1',
      limits: {
        ratePerMin: settings?.snapshot.inboundRatePerMin ?? DEFAULT_PARTNER_RATE_PER_MIN,
        burst: settings?.snapshot.inboundBurst ?? DEFAULT_PARTNER_BURST,
      },
    })
  } catch (err) {
    return authErrorResponse(err)
  }

  const result = await getMemberJob(jobId, integrationId, new Date())
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.view, { status: 200 })
}
