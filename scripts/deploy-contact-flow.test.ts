import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/restaurant-repository')
vi.mock('@/infrastructure/kapso/template-client')
vi.mock('@/infrastructure/kapso/flow-client')

const mockDeprecate = vi.fn()
vi.mock('@kapso/whatsapp-cloud-api', async () => {
  const actual = await vi.importActual<typeof import('@kapso/whatsapp-cloud-api')>(
    '@kapso/whatsapp-cloud-api'
  )
  return {
    ...actual,
    WhatsAppClient: class {
      flows = { deprecate: mockDeprecate }
    },
  }
})

import {
  resolveScriptConfig,
  formatValidationErrors,
  toDeployOutcome,
  forceDeploy,
} from './deploy-contact-flow'
import type { FlowValidationError } from '@kapso/whatsapp-cloud-api'
import {
  getContactFlowId,
  updateContactFlowId,
  getMetaBusinessAccountId,
  getRestaurantPhoneNumberId,
  updateMetaBusinessAccountId,
} from '@/infrastructure/supabase/repositories/restaurant-repository'
import { resolveWabaId } from '@/infrastructure/kapso/template-client'
import { deployContactFlow } from '@/infrastructure/kapso/flow-client'

const RESTAURANT_ID = 'rest-1'
const KAPSO_API_KEY = 'key-abc'

describe('resolveScriptConfig', () => {
  it('resolves from --restaurant-id + KAPSO_API_KEY env', () => {
    const result = resolveScriptConfig(
      ['--restaurant-id', 'rid-123'],
      { KAPSO_API_KEY: 'key-abc' }
    )
    expect(result).toEqual({
      ok: true,
      config: { restaurantId: 'rid-123', force: false, kapsoApiKey: 'key-abc' },
    })
  })

  it('parses --force', () => {
    const result = resolveScriptConfig(
      ['--restaurant-id', 'rid-123', '--force'],
      { KAPSO_API_KEY: 'key-abc' }
    )
    expect(result.ok && result.config.force).toBe(true)
  })

  it('defaults --force to false when absent', () => {
    const result = resolveScriptConfig(
      ['--restaurant-id', 'rid-123'],
      { KAPSO_API_KEY: 'key-abc' }
    )
    expect(result.ok && result.config.force).toBe(false)
  })

  it('errors when --restaurant-id is missing', () => {
    const result = resolveScriptConfig([], { KAPSO_API_KEY: 'key-abc' })
    expect(result).toEqual({
      ok: false,
      error: 'Missing --restaurant-id.',
    })
  })

  it('errors when KAPSO_API_KEY is missing', () => {
    const result = resolveScriptConfig(['--restaurant-id', 'rid-123'], {})
    expect(result).toEqual({
      ok: false,
      error: 'Missing KAPSO_API_KEY in the environment.',
    })
  })

  it('no longer accepts --waba-id (unknown flag rejected)', () => {
    const result = resolveScriptConfig(
      ['--waba-id', '12345'],
      { KAPSO_API_KEY: 'key-abc' }
    )
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/Invalid arguments/)
  })

  it('errors clearly on an unparseable argv (no throw escapes)', () => {
    const result = resolveScriptConfig(['--unknown-flag', 'x'], {
      KAPSO_API_KEY: 'key-abc',
    })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/Invalid arguments/)
  })
})

describe('formatValidationErrors', () => {
  it('formats message, line/column pointers, and hint', () => {
    const errors: FlowValidationError[] = [
      {
        error: 'INVALID_PROPERTY',
        errorType: 'SCHEMA',
        message: 'Unknown property "input-type"',
        lineStart: 12,
        lineEnd: 12,
        columnStart: 5,
        columnEnd: 20,
        hint: 'Use camelCase authoring.',
        pointers: [{ path: '$.screens[0].layout.children[0]', lineStart: 12, columnStart: 5 }],
      },
    ]

    const lines = formatValidationErrors(errors)

    expect(lines[0]).toBe(
      '1. [SCHEMA] Unknown property "input-type" (line 12, col 5-20)'
    )
    expect(lines).toContain('   hint: Use camelCase authoring.')
    expect(lines.some((l) => l.includes('$.screens[0].layout.children[0]'))).toBe(true)
  })

  it('numbers multiple errors and tolerates missing optional fields', () => {
    const errors: FlowValidationError[] = [
      { error: 'FIRST' },
      { error: 'SECOND', message: 'second message' },
    ]

    const lines = formatValidationErrors(errors)

    expect(lines[0]).toBe('1. [FIRST] FIRST')
    expect(lines[1]).toBe('2. [SECOND] second message')
  })
})

describe('toDeployOutcome', () => {
  it('maps an ok result to an ok outcome', () => {
    const outcome = toDeployOutcome({ ok: true, flowId: 'flow-1', created: true })
    expect(outcome).toEqual({ ok: true, flowId: 'flow-1' })
  })

  it('maps a plain-error result to a failure with no validationErrors', () => {
    const outcome = toDeployOutcome({ ok: false, error: 'contact_flow.no_waba_id' })
    expect(outcome).toEqual({
      ok: false,
      failure: { error: 'contact_flow.no_waba_id', validationErrors: undefined },
    })
  })

  it('maps a flow_validation_error response onto the non-zero exit path with structured errors', () => {
    const errors: FlowValidationError[] = [{ error: 'INVALID_PROPERTY', message: 'bad title binding' }]
    const outcome = toDeployOutcome({
      ok: false,
      error: 'flow_validation_error',
      validationErrors: errors,
    })

    expect(outcome.ok).toBe(false)
    expect(!outcome.ok && outcome.failure.validationErrors).toEqual(errors)
  })
})

describe('forceDeploy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getContactFlowId).mockResolvedValue(null)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-1')
    vi.mocked(resolveWabaId).mockResolvedValue('derived-waba')
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue(null)
    vi.mocked(deployContactFlow).mockResolvedValue({ ok: true, flowId: 'flow-new' })
    mockDeprecate.mockResolvedValue(undefined)
  })

  it('resolves the WABA via the shared derive-first algorithm — no --waba-id needed', async () => {
    const outcome = await forceDeploy(RESTAURANT_ID, KAPSO_API_KEY)

    expect(resolveWabaId).toHaveBeenCalledWith('phone-1')
    expect(deployContactFlow).toHaveBeenCalledWith('derived-waba')
    expect(outcome).toEqual({ ok: true, flowId: 'flow-new' })
  })

  it('persists the derived WABA only when the stored value is empty, same as the non-force path', async () => {
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue(null)

    await forceDeploy(RESTAURANT_ID, KAPSO_API_KEY)

    expect(updateMetaBusinessAccountId).toHaveBeenCalledWith(RESTAURANT_ID, 'derived-waba')
  })

  it('never overwrites a non-empty stored WABA', async () => {
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('stored-waba')

    await forceDeploy(RESTAURANT_ID, KAPSO_API_KEY)

    expect(updateMetaBusinessAccountId).not.toHaveBeenCalled()
    expect(deployContactFlow).toHaveBeenCalledWith('derived-waba')
  })

  it('fails without deploying when both derived and stored WABA are unavailable', async () => {
    vi.mocked(resolveWabaId).mockResolvedValue(null)
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue(null)

    const outcome = await forceDeploy(RESTAURANT_ID, KAPSO_API_KEY)

    expect(outcome).toEqual({ ok: false, failure: { error: 'contact_flow.no_waba_id' } })
    expect(deployContactFlow).not.toHaveBeenCalled()
  })

  it('deploys a new flow and best-effort deprecates the previous one', async () => {
    vi.mocked(getContactFlowId).mockResolvedValue('flow-old')

    const outcome = await forceDeploy(RESTAURANT_ID, KAPSO_API_KEY)

    expect(updateContactFlowId).toHaveBeenCalledWith(RESTAURANT_ID, 'flow-new')
    expect(mockDeprecate).toHaveBeenCalledWith({ flowId: 'flow-old' })
    expect(outcome).toEqual({ ok: true, flowId: 'flow-new' })
  })

  it('does not attempt to deprecate when there was no previous flow', async () => {
    vi.mocked(getContactFlowId).mockResolvedValue(null)

    await forceDeploy(RESTAURANT_ID, KAPSO_API_KEY)

    expect(mockDeprecate).not.toHaveBeenCalled()
  })

  it('still returns a success outcome when the best-effort deprecate of the previous flow rejects (USAGE promises this is logged, never fatal — code review L1)', async () => {
    vi.mocked(getContactFlowId).mockResolvedValue('flow-old')
    mockDeprecate.mockRejectedValue(new Error('deprecate boom'))

    const outcome = await forceDeploy(RESTAURANT_ID, KAPSO_API_KEY)

    expect(mockDeprecate).toHaveBeenCalledWith({ flowId: 'flow-old' })
    expect(outcome).toEqual({ ok: true, flowId: 'flow-new' })
  })

  it('returns a failure outcome, never throwing, when the deploy is rejected by Meta', async () => {
    vi.mocked(deployContactFlow).mockResolvedValue({
      ok: false,
      flowId: null,
      validationErrors: [{ error: 'INVALID', message: 'bad thing' }],
    })

    const outcome = await forceDeploy(RESTAURANT_ID, KAPSO_API_KEY)

    expect(outcome.ok).toBe(false)
    expect(updateContactFlowId).not.toHaveBeenCalled()
  })
})
