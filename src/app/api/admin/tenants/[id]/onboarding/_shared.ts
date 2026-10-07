// WONB-001: shared route helpers for the onboarding sub-routes. Centralizes
// auth + rate-limit + UUID validation + error→status mapping so each route
// stays under the per-file LOC limit.

import { NextResponse } from 'next/server'
import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import {
  ConcurrentAdvanceError,
  OnboardingAdvanceError,
  OnboardingPathLockedError,
  OnboardingPathRequiredError,
  OnboardingTerminalError,
} from '@/domain/services/__errors__/onboarding-errors'
import { ValidationError } from '@/infrastructure/validation/onboarding-validators'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface AdminGate {
  userId: string
}

export type GateOutcome =
  | { kind: 'ok'; gate: AdminGate }
  | { kind: 'response'; response: NextResponse }

export async function gate(): Promise<GateOutcome> {
  try {
    const { userId } = await assertPlatformAdmin()
    if (!checkAdminRateLimit(userId).success) {
      return {
        kind: 'response',
        response: NextResponse.json({ error: 'Too many requests' }, { status: 429 }),
      }
    }
    return { kind: 'ok', gate: { userId } }
  } catch (error) {
    return { kind: 'response', response: handleError(error) }
  }
}

export function ensureValidId(id: string): NextResponse | null {
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid tenant ID' }, { status: 400 })
  }
  return null
}

export function handleError(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  if (error instanceof ValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  if (error instanceof OnboardingPathLockedError) {
    return NextResponse.json({ error: error.message, reason: 'phase_locked' }, { status: 409 })
  }
  if (error instanceof ConcurrentAdvanceError) {
    return NextResponse.json(
      { error: error.message, reason: 'concurrent_advance' },
      { status: 409 }
    )
  }
  // Defensive: not reachable from current routes (entity-thrown
  // OnboardingTerminalError / OnboardingPathRequiredError are translated to
  // OnboardingAdvanceError in `advancePhase`'s pre-checks). Wired anyway so
  // future routes that surface the entity errors directly map cleanly.
  if (error instanceof OnboardingTerminalError) {
    return NextResponse.json(
      { error: error.message, reason: 'phase_terminal' },
      { status: 409 }
    )
  }
  if (error instanceof OnboardingPathRequiredError) {
    return NextResponse.json(
      { error: error.message, reason: 'no_path' },
      { status: 409 }
    )
  }
  if (error instanceof OnboardingAdvanceError) {
    return NextResponse.json({ error: error.message, reason: error.reason }, { status: 409 })
  }
  console.error('Onboarding route error:', error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
