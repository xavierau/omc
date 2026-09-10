// INT-001 WI-3: POST /api/integrations/{integrationId}/members (spec US-1).
// kanban INT-001 CONSTRAINT (binding): this route does ONLY auth ->
// validate -> enqueue -> 202. No `members` write, no consent write, no
// welcome decision here -- all of that is `process-member-create-job.ts`,
// running in the `integration-inbound` worker (a spy test on
// `insertMemberJob`/the seam proves this route never reaches either).

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { authenticateIntegrationV2 } from '../verify-signature-v2'
import { authErrorResponse } from '../inbound-auth-response'
import {
  DEFAULT_PARTNER_BURST,
  DEFAULT_PARTNER_RATE_PER_MIN,
  checkPreAuthThrottle,
} from '@/application/integration-inbound-guard'
import { systemClock } from '@/infrastructure/clock/system-clock'
import { validateCreateMemberBody } from '@/infrastructure/validation/integration-member-validators'
import { findIntegrationSettingsById } from '@/infrastructure/supabase/repositories/integration-settings-repository'
import { enqueueMemberCreate, DEFAULT_INBOUND_QUEUE_CAP } from '@/application/enqueue-member-create'
import {
  addMemberCreateJob,
  getGlobalCeilingGuard,
  getInboundRateLimiter,
} from '@/infrastructure/queue/integration-inbound-queue'
import type { CreateMemberAcceptedResponse } from '@/application/dtos/integration-member-api'

const MAX_BODY_BYTES = 16 * 1024

interface RouteParams {
  params: Promise<{ integrationId: string }>
}

function sha256hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function jobIdKeyOrThrow(): string {
  const key = process.env.INT_JOBID_KEY
  if (!key) throw new Error('POST members: INT_JOBID_KEY is not set')
  return key
}

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { integrationId } = await params

  // I-1/I-2: cheap, integration-scoped throttle checked BEFORE anything
  // else -- no Postgres read (not `findIntegrationSettingsById` below, not
  // `findPosIntegrationById` inside authenticateIntegrationV2) and no body
  // buffering has happened yet. Keyed on integrationId alone, so a
  // client-controlled header can't be used to dodge it (I-2's XFF-spoofing
  // lesson applied here too).
  const preAuth = await checkPreAuthThrottle(getInboundRateLimiter(), integrationId)
  if (!preAuth.ok) {
    const headers = preAuth.status === 429 ? { 'Retry-After': '5' } : undefined
    return NextResponse.json({ error: preAuth.error }, { status: preAuth.status, headers })
  }

  // I-1: enforce the 16 KiB cap from Content-Length BEFORE reading the
  // body -- a truthful oversized header is now rejected without ever
  // buffering it. The post-read byte-length check below stays as a
  // backstop for a lying or absent header.
  const contentLengthHeader = request.headers.get('content-length')
  const contentLength = contentLengthHeader ? Number(contentLengthHeader) : NaN
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 })
  }

  const rawBody = await request.text()
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 })
  }

  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    return NextResponse.json({ error: 'unsupported_media_type' }, { status: 415 })
  }

  // Loaded regardless of auth outcome (integrationId is a URL param, not a
  // secret) -- gives authenticateIntegrationV2 the real per-integration
  // rate limits before it charges anything.
  const settings = await findIntegrationSettingsById(integrationId).catch(() => null)

  let authResult
  try {
    authResult = await authenticateIntegrationV2({
      integrationId,
      kind: 'member.create',
      headers: {
        timestamp: request.headers.get('x-omc-timestamp'),
        nonce: request.headers.get('x-omc-nonce'),
        signature: request.headers.get('x-omc-signature'),
      },
      digest: sha256hex(rawBody),
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

  // I-4: the nonce-replay verdict used to be computed and silently
  // discarded. The partner doc's own documented contract (§2: "a repeat
  // within 10 minutes is treated as a retried, not a new, request") means
  // this must NOT reject or change the response -- POST is already
  // content-addressed (T-H3b), so a replay legitimately reproduces the
  // SAME job_id/202 below, same as any other retried submission. Logged
  // so the signal has an effect (ops visibility) instead of being dead.
  if (authResult.replayed) {
    console.warn('[IntegrationInboundAuth] replayed nonce', { integrationId, kind: 'member.create' })
  }

  let body: unknown
  try {
    body = rawBody.length === 0 ? {} : JSON.parse(rawBody)
  } catch {
    return NextResponse.json(
      { error: 'validation', fields: [{ field: 'body', code: 'not_object' }] },
      { status: 422 }
    )
  }

  const validation = validateCreateMemberBody(body)
  if (!validation.ok) {
    return NextResponse.json({ error: 'validation', fields: validation.fields }, { status: 422 })
  }

  const result = await enqueueMemberCreate(
    {
      integrationId,
      restaurantId: authResult.integration.restaurantId,
      phoneE164: validation.value.phoneE164.value,
      phoneLast4: validation.value.phoneE164.last4,
      consentLevel: validation.value.consentLevel,
      name: validation.value.name,
      externalRef: validation.value.externalRef,
      language: validation.value.language,
      sendWelcome: validation.value.sendWelcome,
      metadata: validation.value.metadata,
      queueCap: settings?.snapshot.inboundQueueCap ?? DEFAULT_INBOUND_QUEUE_CAP,
    },
    {
      rateLimiter: getInboundRateLimiter(),
      globalCeilingGuard: getGlobalCeilingGuard(),
      addMemberCreateJob,
      jobIdKey: jobIdKeyOrThrow(),
    }
  )

  if (!result.ok) {
    const headers = result.error === 'queue_depth_exceeded' ? { 'Retry-After': '5' } : undefined
    return NextResponse.json({ error: result.error }, { status: result.status, headers })
  }

  const accepted: CreateMemberAcceptedResponse = {
    job_id: result.jobId,
    status: result.status,
    poll_url: `/api/integrations/${integrationId}/members/jobs/${result.jobId}`,
  }
  return NextResponse.json(accepted, { status: 202 })
}
