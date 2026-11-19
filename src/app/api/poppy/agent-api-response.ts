/**
 * BOOK-003 (R38): every agent API response is JSON with no-store and
 * no-referrer (plus the booking pages' noindex). Errors follow PAP section 7's
 * JSON body shape: `{error, error_description}`.
 */
import { NextResponse } from 'next/server'
import { applyBookingHeaders } from '@/app/b/booking-security-headers'

export type AgentApiError = 'invalid_request' | 'rate_limited' | 'not_found' | 'idempotency_conflict' | 'server_error'

export function agentJson(body: unknown, status: number, headers?: Record<string, string>): NextResponse {
  return applyBookingHeaders(NextResponse.json(body, { status, headers }))
}

export function agentError(
  error: AgentApiError,
  status: number,
  description: string,
  extra: { fields?: Record<string, string>; retryAfterSec?: number } = {}
): NextResponse {
  const body = { error, error_description: description, ...(extra.fields ? { fields: extra.fields } : {}) }
  return agentJson(body, status, extra.retryAfterSec ? { 'Retry-After': String(extra.retryAfterSec) } : undefined)
}

export const notFound = () => agentError('not_found', 404, 'No booking API at this address, or no such booking.')
