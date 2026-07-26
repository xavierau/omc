import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockDeploy = vi.fn()
const mockDeprecate = vi.fn()
const mockClientCtor = vi.fn()

// Mirrors template-client.test.ts's mocking pattern: real SDK types are kept,
// only WhatsAppClient's constructor + the `flows` resource are stubbed.
vi.mock('@kapso/whatsapp-cloud-api', async () => {
  const actual = await vi.importActual<typeof import('@kapso/whatsapp-cloud-api')>(
    '@kapso/whatsapp-cloud-api'
  )
  return {
    ...actual,
    WhatsAppClient: class {
      constructor(config: unknown) {
        mockClientCtor(config)
      }
      flows = { deploy: mockDeploy, deprecate: mockDeprecate }
    },
  }
})

// `cachedClient` is module-level, so every test needs a fresh module registry.
async function importClient() {
  vi.resetModules()
  return import('../flow-client')
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('deployContactFlow', () => {
  it('returns kapso_no_api_key without constructing a client when no API key', async () => {
    vi.stubEnv('KAPSO_API_KEY', '')
    const { deployContactFlow } = await importClient()

    const result = await deployContactFlow('waba-1')

    expect(result).toEqual({ ok: false, flowId: null, error: { title: 'kapso_no_api_key' } })
    expect(mockClientCtor).not.toHaveBeenCalled()
    expect(mockDeploy).not.toHaveBeenCalled()
  })

  it('deploys with no flowId option, using a name that carries the identifiable prefix', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    mockDeploy.mockResolvedValue({ flowId: 'flow-123' })
    const { deployContactFlow } = await importClient()

    const result = await deployContactFlow('waba-1')

    expect(result).toEqual({ ok: true, flowId: 'flow-123' })
    expect(mockDeploy).toHaveBeenCalledTimes(1)
    const [, options] = mockDeploy.mock.calls[0]
    expect(options).toMatchObject({ wabaId: 'waba-1', publish: true })
    expect(options.name).toMatch(/^ohmyclient_contact_form_/)
    expect(options.flowId).toBeUndefined()
  })

  it('requests a different name on each successive create — a collision is structurally impossible', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    mockDeploy.mockResolvedValue({ flowId: 'flow-123' })
    const { deployContactFlow } = await importClient()

    await deployContactFlow('waba-1')
    await deployContactFlow('waba-1')

    expect(mockDeploy).toHaveBeenCalledTimes(2)
    const firstName = mockDeploy.mock.calls[0][1].name
    const secondName = mockDeploy.mock.calls[1][1].name
    expect(firstName).toMatch(/^ohmyclient_contact_form_/)
    expect(secondName).toMatch(/^ohmyclient_contact_form_/)
    expect(firstName).not.toBe(secondName)
  })

  it('maps a Meta name-uniqueness collision to a clear, actionable failure Result, never throwing', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    const { GraphApiError } = await vi.importActual<typeof import('@kapso/whatsapp-cloud-api')>(
      '@kapso/whatsapp-cloud-api'
    )
    const collisionError = new GraphApiError({
      message: 'Flow name is not unique',
      httpStatus: 400,
      code: 100,
      type: 'OAuthException',
      category: 'parameter',
      retry: { action: 'fix_and_retry' },
      raw: {},
    })
    mockDeploy.mockRejectedValue(collisionError)
    const { deployContactFlow } = await importClient()

    const result = await deployContactFlow('waba-1')

    expect(result.ok).toBe(false)
    expect(result.flowId).toBeNull()
    expect(result.error?.title).toBe('flow_name_not_unique')
    expect(result.error?.details).toMatch(/retry/i)
    expect(result.error?.details).not.toMatch(/is not unique/i)
  })

  it('does not misclassify an unrelated code-100 parameter error as a name collision', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    const { GraphApiError } = await vi.importActual<typeof import('@kapso/whatsapp-cloud-api')>(
      '@kapso/whatsapp-cloud-api'
    )
    const unrelatedError = new GraphApiError({
      message: 'Invalid parameter',
      httpStatus: 400,
      code: 100,
      type: 'OAuthException',
      category: 'parameter',
      retry: { action: 'fix_and_retry' },
      raw: {},
    })
    mockDeploy.mockRejectedValue(unrelatedError)
    const { deployContactFlow } = await importClient()

    const result = await deployContactFlow('waba-1')

    expect(result.error?.title).toBe('flow_deploy_error')
    expect(result.error?.details).toBe('Invalid parameter')
  })

  it('returns ok:false with validationErrors when Meta rejects the Flow JSON', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    const validationErrors = [{ error: 'INVALID', message: 'bad thing' }]
    mockDeploy.mockResolvedValue({ flowId: 'flow-x', validationErrors })
    const { deployContactFlow } = await importClient()

    const result = await deployContactFlow('waba-1')

    expect(result.ok).toBe(false)
    expect(result.flowId).toBeNull()
    expect(result.validationErrors).toEqual(validationErrors)
  })

  it('reports a generic thrown error as flow_deploy_error, never throwing', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    mockDeploy.mockRejectedValue(new Error('boom'))
    const { deployContactFlow } = await importClient()

    const result = await deployContactFlow('waba-1')

    expect(result).toEqual({
      ok: false,
      flowId: null,
      error: { title: 'flow_deploy_error', details: 'boom' },
    })
  })

  it('resolves ok:false on timeout instead of hanging or rejecting', async () => {
    vi.useFakeTimers()
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    // Never settles — simulates a stalled Meta round-trip.
    mockDeploy.mockImplementation(() => new Promise(() => {}))
    const { deployContactFlow, DEPLOY_TIMEOUT_MS } = await importClient()

    const pending = deployContactFlow('waba-1')
    await vi.advanceTimersByTimeAsync(DEPLOY_TIMEOUT_MS)
    const result = await pending

    expect(result).toEqual({
      ok: false,
      flowId: null,
      error: { title: 'flow_deploy_timeout' },
    })
  })
})

describe('withTimeout', () => {
  afterEach(() => vi.useRealTimers())

  it('resolves with the wrapped promise value when it settles before the timeout', async () => {
    const { withTimeout } = await importClient()

    await expect(withTimeout(Promise.resolve('value'), 1_000)).resolves.toBe('value')
  })

  it('rejects with a TimeoutError once the timeout elapses, and clears the timer', async () => {
    vi.useFakeTimers()
    const { withTimeout, TimeoutError } = await importClient()

    const pending = withTimeout(new Promise(() => {}), 5_000)
    const assertion = expect(pending).rejects.toBeInstanceOf(TimeoutError)
    await vi.advanceTimersByTimeAsync(5_000)
    await assertion
  })

  it('propagates the wrapped promise rejection, not a TimeoutError, when it rejects first', async () => {
    const { withTimeout, TimeoutError } = await importClient()

    await expect(withTimeout(Promise.reject(new Error('boom')), 5_000)).rejects.toThrow('boom')
    await expect(withTimeout(Promise.reject(new Error('boom')), 5_000)).rejects.not.toBeInstanceOf(
      TimeoutError
    )
  })
})

describe('describeDeployFailure', () => {
  it('prefers structured validationErrors when present', async () => {
    const { describeDeployFailure } = await importClient()
    const errors = [{ error: 'INVALID_PROPERTY' }]

    const failure = describeDeployFailure({ ok: false, flowId: null, validationErrors: errors })

    expect(failure).toEqual({ error: 'flow_validation_error', validationErrors: errors })
  })

  it('falls back to error.details, then error.title, then a generic message', async () => {
    const { describeDeployFailure } = await importClient()

    expect(
      describeDeployFailure({
        ok: false,
        flowId: null,
        error: { title: 'flow_deploy_error', details: 'timeout' },
      })
    ).toEqual({ error: 'timeout' })

    expect(
      describeDeployFailure({ ok: false, flowId: null, error: { title: 'kapso_no_api_key' } })
    ).toEqual({ error: 'kapso_no_api_key' })

    expect(describeDeployFailure({ ok: false, flowId: null })).toEqual({
      error: 'flow_deploy_failed',
    })
  })
})

describe('deprecateContactFlow', () => {
  it('does nothing (and never throws) when no API key is configured', async () => {
    vi.stubEnv('KAPSO_API_KEY', '')
    const { deprecateContactFlow } = await importClient()

    await expect(deprecateContactFlow('flow-1')).resolves.toBeUndefined()
    expect(mockClientCtor).not.toHaveBeenCalled()
  })

  it('deprecates the given flow id when an API key is configured', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    mockDeprecate.mockResolvedValue(undefined)
    const { deprecateContactFlow } = await importClient()

    await deprecateContactFlow('flow-1')

    expect(mockDeprecate).toHaveBeenCalledWith({ flowId: 'flow-1' })
  })

  it('logs and swallows a deprecate failure, never throwing', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    mockDeprecate.mockRejectedValue(new Error('deprecate boom'))
    const { deprecateContactFlow } = await importClient()

    await expect(deprecateContactFlow('flow-1')).resolves.toBeUndefined()
  })
})
