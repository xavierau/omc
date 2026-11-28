import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockCreate = vi.fn()
const mockPublish = vi.fn()
const mockDeprecate = vi.fn()
const mockRequest = vi.fn()
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
      flows = { create: mockCreate, publish: mockPublish, deprecate: mockDeprecate }
      request = mockRequest
    },
  }
})

// `cachedClient` is module-level, so every test needs a fresh module registry.
async function importClient() {
  vi.resetModules()
  return import('../flow-client')
}

const PHONE = 'phone-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockRequest.mockResolvedValue({ ok: true, status: 200 })
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

    const result = await deployContactFlow('waba-1', PHONE)

    expect(result).toEqual({ ok: false, flowId: null, error: { title: 'kapso_no_api_key' } })
    expect(mockClientCtor).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  // Issue #78: creating a flow we then cannot publish is precisely the orphan
  // this guard exists to prevent, so refuse before touching Meta at all.
  it('refuses without creating anything when no phone number id is supplied', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    const { deployContactFlow } = await importClient()

    const result = await deployContactFlow('waba-1', '')

    expect(result).toEqual({
      ok: false,
      flowId: null,
      error: { title: 'flow_no_phone_number_id' },
    })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('creates unpublished, then publishes, using a name that carries the identifiable prefix', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    mockCreate.mockResolvedValue({ id: 'flow-123' })
    mockPublish.mockResolvedValue(undefined)
    const { deployContactFlow } = await importClient()

    const result = await deployContactFlow('waba-1', PHONE)

    expect(result).toEqual({ ok: true, flowId: 'flow-123' })
    expect(mockCreate).toHaveBeenCalledTimes(1)
    const [options] = mockCreate.mock.calls[0]
    expect(options).toMatchObject({ wabaId: 'waba-1', publish: false })
    expect(options.name).toMatch(/^ohmyclient_contact_form_/)
    expect(options.flowId).toBeUndefined()
  })

  // The regression this fix exists for: publish is flow-scoped, and Kapso
  // answers 404 "WhatsApp configuration not found" unless the phone number id
  // rides along to identify the WhatsApp config.
  it('routes the publish call with the phone number id', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    mockCreate.mockResolvedValue({ id: 'flow-123' })
    mockPublish.mockResolvedValue(undefined)
    const { deployContactFlow } = await importClient()

    await deployContactFlow('waba-1', PHONE)

    expect(mockPublish).toHaveBeenCalledWith({ flowId: 'flow-123', phoneNumberId: PHONE })
  })

  it('requests a different name on each successive create — a collision is structurally impossible', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    mockCreate.mockResolvedValue({ id: 'flow-123' })
    mockPublish.mockResolvedValue(undefined)
    const { deployContactFlow } = await importClient()

    await deployContactFlow('waba-1', PHONE)
    await deployContactFlow('waba-1', PHONE)

    expect(mockCreate).toHaveBeenCalledTimes(2)
    const firstName = mockCreate.mock.calls[0][0].name
    const secondName = mockCreate.mock.calls[1][0].name
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
    mockCreate.mockRejectedValue(collisionError)
    const { deployContactFlow } = await importClient()

    const result = await deployContactFlow('waba-1', PHONE)

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
    mockCreate.mockRejectedValue(unrelatedError)
    const { deployContactFlow } = await importClient()

    const result = await deployContactFlow('waba-1', PHONE)

    expect(result.error?.title).toBe('flow_deploy_error')
    expect(result.error?.details).toBe('Invalid parameter')
  })

  it('returns ok:false with validationErrors when Meta rejects the Flow JSON', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    const validationErrors = [{ error: 'INVALID', message: 'bad thing' }]
    mockCreate.mockResolvedValue({ id: 'flow-x', validationErrors })
    const { deployContactFlow } = await importClient()

    const result = await deployContactFlow('waba-1', PHONE)

    expect(result.ok).toBe(false)
    expect(result.flowId).toBeNull()
    expect(result.validationErrors).toEqual(validationErrors)
  })

  // Meta refuses to publish a flow that failed validation, so publishing is
  // pointless — and the DRAFT it created must not be left behind.
  it('never publishes an invalid flow, and discards the draft it created', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    mockCreate.mockResolvedValue({ id: 'flow-x', validationErrors: [{ error: 'INVALID' }] })
    const { deployContactFlow } = await importClient()

    await deployContactFlow('waba-1', PHONE)

    expect(mockPublish).not.toHaveBeenCalled()
    expect(mockRequest).toHaveBeenCalledWith('DELETE', '/flow-x', {
      query: { phoneNumberId: PHONE },
    })
  })

  // Meta only deprecates PUBLISHED flows — a deprecate on a draft comes back
  // "Deprecating attempt failed" and leaves it in place, which is exactly how
  // this was wrong the first time. Drafts must be DELETEd.
  it('discards drafts with DELETE, never deprecate', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    mockCreate.mockResolvedValue({ id: 'flow-x', validationErrors: [{ error: 'INVALID' }] })
    const { deployContactFlow } = await importClient()

    await deployContactFlow('waba-1', PHONE)

    expect(mockDeprecate).not.toHaveBeenCalled()
  })

  // Before this fix every failed save leaked a DRAFT flow at Meta, because the
  // id of a created-but-unpublished flow was dropped on the floor.
  it('discards the created flow when publishing fails, leaking no orphan', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    mockCreate.mockResolvedValue({ id: 'flow-orphan' })
    mockPublish.mockRejectedValue(new Error('publish boom'))
    const { deployContactFlow } = await importClient()

    const result = await deployContactFlow('waba-1', PHONE)

    expect(result).toEqual({
      ok: false,
      flowId: null,
      error: { title: 'flow_deploy_error', details: 'publish boom' },
    })
    expect(mockRequest).toHaveBeenCalledWith('DELETE', '/flow-orphan', {
      query: { phoneNumberId: PHONE },
    })
  })

  it('still reports the publish failure when the orphan cleanup itself fails', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    mockCreate.mockResolvedValue({ id: 'flow-orphan' })
    mockPublish.mockRejectedValue(new Error('publish boom'))
    mockRequest.mockRejectedValue(new Error('delete boom'))
    const { deployContactFlow } = await importClient()

    const result = await deployContactFlow('waba-1', PHONE)

    expect(result.error).toEqual({ title: 'flow_deploy_error', details: 'publish boom' })
  })

  it('reports a generic thrown error as flow_deploy_error, never throwing', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    mockCreate.mockRejectedValue(new Error('boom'))
    const { deployContactFlow } = await importClient()

    const result = await deployContactFlow('waba-1', PHONE)

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
    mockCreate.mockImplementation(() => new Promise(() => {}))
    const { deployContactFlow, DEPLOY_TIMEOUT_MS } = await importClient()

    const pending = deployContactFlow('waba-1', PHONE)
    await vi.advanceTimersByTimeAsync(DEPLOY_TIMEOUT_MS)
    const result = await pending

    expect(result).toEqual({
      ok: false,
      flowId: null,
      error: { title: 'flow_deploy_timeout' },
    })
  })

  // The timeout bounds create + publish as one unit, so a stall in the second
  // call is capped by the same budget as a stall in the first.
  it('bounds a stalled publish with the same timeout', async () => {
    vi.useFakeTimers()
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    mockCreate.mockResolvedValue({ id: 'flow-123' })
    mockPublish.mockImplementation(() => new Promise(() => {}))
    const { deployContactFlow, DEPLOY_TIMEOUT_MS } = await importClient()

    const pending = deployContactFlow('waba-1', PHONE)
    await vi.advanceTimersByTimeAsync(DEPLOY_TIMEOUT_MS)

    expect(await pending).toEqual({
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

    await expect(deprecateContactFlow('flow-1', PHONE)).resolves.toBeUndefined()
    expect(mockClientCtor).not.toHaveBeenCalled()
  })

  // Same routing requirement as publish — without the phone number id Kapso
  // 404s and the orphan stays orphaned.
  it('deprecates the given flow id, routed with the phone number id', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    mockDeprecate.mockResolvedValue(undefined)
    const { deprecateContactFlow } = await importClient()

    await deprecateContactFlow('flow-1', PHONE)

    expect(mockDeprecate).toHaveBeenCalledWith({ flowId: 'flow-1', phoneNumberId: PHONE })
  })

  it('logs and swallows a deprecate failure, never throwing', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    mockDeprecate.mockRejectedValue(new Error('deprecate boom'))
    const { deprecateContactFlow } = await importClient()

    await expect(deprecateContactFlow('flow-1', PHONE)).resolves.toBeUndefined()
  })
})
