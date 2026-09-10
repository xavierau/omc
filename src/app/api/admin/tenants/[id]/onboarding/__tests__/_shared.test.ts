// WONB-001: defensive coverage for handleError. Several onboarding errors
// are unreachable from current routes but the mapper exists so future routes
// (or refactors) get the right HTTP status without changing the helper.

import { describe, it, expect } from 'vitest'
import {
  ConcurrentAdvanceError,
  OnboardingAdvanceError,
  OnboardingPathLockedError,
  OnboardingPathRequiredError,
  OnboardingTerminalError,
} from '@/domain/services/__errors__/onboarding-errors'
import { ValidationError } from '@/infrastructure/validation/onboarding-validators'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { handleError } from '../_shared'

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

describe('handleError', () => {
  it('maps AuthError to its statusCode', async () => {
    const r = handleError(new AuthError('Unauthorized', 401))
    expect(r.status).toBe(401)
  })

  it('maps ValidationError to 400', async () => {
    const r = handleError(new ValidationError('bad'))
    expect(r.status).toBe(400)
  })

  it('maps OnboardingPathLockedError to 409 reason=phase_locked', async () => {
    const r = handleError(new OnboardingPathLockedError())
    expect(r.status).toBe(409)
    expect((await bodyOf(r)).reason).toBe('phase_locked')
  })

  it('maps ConcurrentAdvanceError to 409 reason=concurrent_advance', async () => {
    const r = handleError(new ConcurrentAdvanceError())
    expect(r.status).toBe(409)
    expect((await bodyOf(r)).reason).toBe('concurrent_advance')
  })

  it('maps OnboardingTerminalError to 409 reason=phase_terminal', async () => {
    const r = handleError(new OnboardingTerminalError())
    expect(r.status).toBe(409)
    expect((await bodyOf(r)).reason).toBe('phase_terminal')
  })

  it('maps OnboardingPathRequiredError to 409 reason=no_path', async () => {
    const r = handleError(new OnboardingPathRequiredError())
    expect(r.status).toBe(409)
    expect((await bodyOf(r)).reason).toBe('no_path')
  })

  it('maps OnboardingAdvanceError to 409 with the carried reason', async () => {
    const r = handleError(new OnboardingAdvanceError('kpi_failed'))
    expect(r.status).toBe(409)
    expect((await bodyOf(r)).reason).toBe('kpi_failed')
  })

  it('maps unknown error to 500', async () => {
    const r = handleError(new Error('unexpected'))
    expect(r.status).toBe(500)
  })
})
