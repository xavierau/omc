// INT-001 WI-3: GET /api/integrations/{integrationId}/members/jobs/{jobId}
// (spec US-2). Signed, empty body (T-H2's GET variant: `digest` is the
// jobId itself, not a body hash). T-H4: `getMemberJob` is scoped by BOTH
// ids at the repository layer, so an unknown OR foreign job id produce the
// SAME 404 body from this route -- never a 403, never an enumeration
// signal.

import { NextRequest, NextResponse } from 'next/server'
import { authenticateIntegrationV2 } from '../../../verify-signature-v2'
import { authErrorResponse } from '../../../inbound-auth-response'
import {
  DEFAULT_PARTNER_BURST,
  DEFAULT_PARTNER_RATE_PER_MIN,
  checkPreAuthThrottle,
  extractTrustedClientIp,
} from '@/application/integration-inbound-guard'
import { systemClock } from '@/infrastructure/clock/system-clock'
import { findIntegrationSettingsById } from '@/infrastructure/supabase/repositories/integration-settings-repository'
import { getInboundRateLimiter } from '@/infrastructure/queue/integration-inbound-queue'
import { getMemberJob } from '@/application/get-member-job'

interface RouteParams {
  params: Promise<{ integrationId: string; jobId: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { integrationId, jobId } = await params

  // I-1/N-1: see members/route.ts's own comment -- same cheap,
  // (integrationId, trusted client ip)-scoped gate before either Postgres
  // read.
  const preAuth = await checkPreAuthThrottle(getInboundRateLimiter(), integrationId, extractTrustedClientIp(request))
  if (!preAuth.ok) {
    const headers = preAuth.status === 429 ? { 'Retry-After': '5' } : undefined
    return NextResponse.json({ error: preAuth.error }, { status: preAuth.status, headers })
  }

  const settings = await findIntegrationSettingsById(integrationId).catch(() => null)

  let authResult
  try {
    authResult = await authenticateIntegrationV2({
      integrationId,
      kind: 'member.job',
      headers: {
        timestamp: request.headers.get('x-omc-timestamp'),
        nonce: request.headers.get('x-omc-nonce'),
        signature: request.headers.get('x-omc-signature'),
      },
      digest: jobId,
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

  // I-4 (owner ruling, 2026-09-10): see members/route.ts's own comment --
  // `guardInboundRequest` itself now rejects a same-nonce reuse whose
  // digest differs. For GET, `digest` is the `jobId` itself (no request
  // body), so a same-nonce reuse against a DIFFERENT jobId already 401s
  // inside the guard; a reuse polling the SAME job (GET is read-only, so
  // harmless either way) reaches here as `replayed: true` and is logged
  // rather than rejected, matching the partner doc's "treated as a
  // retried, not a new, request" contract without changing the response.
  if (authResult.replayed) {
    console.warn('[IntegrationInboundAuth] replayed nonce (same jobId -- idempotent poll)', {
      integrationId,
      kind: 'member.job',
    })
  }

  const result = await getMemberJob(jobId, integrationId, new Date())
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.view, { status: 200 })
}
