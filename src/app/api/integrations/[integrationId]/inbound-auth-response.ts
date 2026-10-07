// INT-001 WI-3: shared `IntegrationAuthErrorV2` -> `NextResponse` mapping
// for the two v2-signed partner routes (`members/route.ts`,
// `members/jobs/[jobId]/route.ts`). `verify-signature-v2.ts` deliberately
// throws a typed error rather than building a response itself (see that
// file's own header: "that stays with the route, WI-3") -- this is that
// shared piece, factored out once both routes needed the identical
// mapping rather than duplicated verbatim in each.

import { NextResponse } from 'next/server'
import { IntegrationAuthErrorV2 } from './verify-signature-v2'

export function authErrorResponse(error: unknown): NextResponse {
  if (error instanceof IntegrationAuthErrorV2) {
    const headers: Record<string, string> = {}
    if (error.retryAfterSec !== undefined) headers['Retry-After'] = String(error.retryAfterSec)
    if (error.remaining !== undefined) headers['X-RateLimit-Remaining'] = String(error.remaining)
    return NextResponse.json({ error: error.errorCode }, { status: error.statusCode, headers })
  }
  console.error('[IntegrationInboundAuth] unexpected error', error instanceof Error ? error.message : error)
  return NextResponse.json({ error: 'queue_unavailable' }, { status: 503 })
}
