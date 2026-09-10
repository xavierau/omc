// INT-001 WI-9 — frozen acceptance suite (authored before the cards, per
// the dev-task-loop: derived from the WI-8 route contracts in
// artifacts/2026-09-10-int-001-wi8-backend / -wi0-backend, not from this
// file's own implementation). Mirrors `tag-client.test.ts`'s mocked-fetch
// pattern — the only network-testing convention this repo has (no
// jsdom/RTL).

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  fetchIntegrations,
  createIntegrationRequest,
  fetchIntegrationDetail,
  fetchIntegrationSettings,
  patchIntegrationSettings,
  putOutboundSecret,
  rotateInboundSecretRequest,
  sendTestEventRequest,
  isTenantAdmin,
  fetchIntegrationDeliveries,
  retryDeliveryRequest,
  fetchIntegrationActivity,
  resumeOutboundRequest,
} from '@/hooks/integrations-client'

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

function mockFetchThrows() {
  const fn = vi.fn().mockRejectedValue(new Error('network down'))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const INTEGRATION = {
  id: 'i-1',
  restaurantId: 'r-1',
  provider: 'generic',
  name: 'Square POS',
  status: 'active' as const,
  fieldMapping: null,
  secretLast4: 'ab12',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

const SETTINGS = {
  newJoinTemplateId: null,
  resolvedTemplate: null,
  consentAttestationText: null,
  consentAttestationAckAt: null,
  outboundUrl: null,
  outboundEvents: [],
  outboundEnabled: false,
  outboundPiiAckAt: null,
  outboundStatus: 'active' as const,
  outboundFailureStreak: 0,
  outboundPausedAt: null,
  outboundSecretLast4: null,
  outboundSecretUpdatedAt: null,
}

describe('fetchIntegrations', () => {
  it('returns the { data } array on 200', async () => {
    mockFetch(200, { data: [INTEGRATION] })
    await expect(fetchIntegrations()).resolves.toEqual({ ok: true, integrations: [INTEGRATION] })
  })

  it('returns the error code on a non-ok response', async () => {
    mockFetch(403, { error: 'Forbidden' })
    await expect(fetchIntegrations()).resolves.toEqual({ ok: false, error: 'Forbidden' })
  })

  it('returns network_error when fetch throws', async () => {
    mockFetchThrows()
    await expect(fetchIntegrations()).resolves.toEqual({ ok: false, error: 'network_error' })
  })
})

describe('createIntegrationRequest', () => {
  it('POSTs the name and returns the create payload on 201', async () => {
    const fetchMock = mockFetch(201, { data: { id: 'i-2', webhookUrl: 'https://x/y', webhookSecret: 'sekret' } })
    const result = await createIntegrationRequest('Square POS')
    expect(result).toEqual({ ok: true, id: 'i-2', webhookUrl: 'https://x/y', webhookSecret: 'sekret' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/dashboard/pos-integrations')
    expect(init).toMatchObject({ method: 'POST' })
    expect(JSON.parse(init.body)).toEqual({ name: 'Square POS' })
  })

  it('surfaces the server error message on 400', async () => {
    mockFetch(400, { error: 'name is required' })
    expect(await createIntegrationRequest('')).toEqual({ ok: false, error: 'name is required' })
  })
})

describe('fetchIntegrationDetail', () => {
  it('returns the integration on 200', async () => {
    mockFetch(200, { data: INTEGRATION })
    await expect(fetchIntegrationDetail('i-1')).resolves.toEqual({ ok: true, integration: INTEGRATION })
  })

  it('carries the HTTP status through on 404 (foreign/unknown id)', async () => {
    mockFetch(404, { error: 'Not found' })
    await expect(fetchIntegrationDetail('i-x')).resolves.toEqual({ ok: false, status: 404, error: 'Not found' })
  })
})

describe('fetchIntegrationSettings', () => {
  it('returns the settings view on 200', async () => {
    mockFetch(200, { data: SETTINGS })
    await expect(fetchIntegrationSettings('i-1')).resolves.toEqual({ ok: true, settings: SETTINGS })
  })

  it('carries the HTTP status through on 403 (staff)', async () => {
    mockFetch(403, { error: 'Forbidden' })
    await expect(fetchIntegrationSettings('i-1')).resolves.toEqual({ ok: false, status: 403, error: 'Forbidden' })
  })
})

describe('patchIntegrationSettings', () => {
  it('PATCHes the given fields and returns settings + warnings on 200', async () => {
    const fetchMock = mockFetch(200, { data: SETTINGS, warnings: ['tenant_quality_paused'] })
    const result = await patchIntegrationSettings('i-1', { newJoinTemplateId: 'default' })
    expect(result).toEqual({ ok: true, settings: SETTINGS, warnings: ['tenant_quality_paused'] })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/dashboard/pos-integrations/i-1/settings')
    expect(init).toMatchObject({ method: 'PATCH' })
    expect(JSON.parse(init.body)).toEqual({ newJoinTemplateId: 'default' })
  })

  it('defaults warnings to [] when the body omits it', async () => {
    mockFetch(200, { data: SETTINGS })
    const result = await patchIntegrationSettings('i-1', { outboundEnabled: false })
    expect(result).toEqual({ ok: true, settings: SETTINGS, warnings: [] })
  })

  // Every SettingsErrorCode this WI's routes can return (400 validator +
  // 422 business-rule) round-trips through unchanged — the presentation
  // mapping lives in settings-error-messages.ts, tested separately.
  it.each([
    'unknown_field',
    'invalid_body',
    'invalid_new_join_template_id',
    'invalid_consent_attestation_text',
    'invalid_consent_attestation_ack',
    'invalid_outbound_url',
    'invalid_outbound_events',
    'invalid_outbound_enabled',
    'invalid_outbound_pii_ack',
    'template_not_found',
    'template_not_approved',
    'template_not_owned',
    'no_default_welcome_template',
    'url_not_https',
    'url_private_address',
    'url_invalid',
    'url_port',
    'url_userinfo',
    'pii_ack_required',
  ])('surfaces the %s error code unchanged', async (code) => {
    mockFetch(code === 'unknown_field' ? 400 : 422, { error: code })
    expect(await patchIntegrationSettings('i-1', {})).toEqual({ ok: false, error: code })
  })

  it('returns network_error when fetch throws', async () => {
    mockFetchThrows()
    expect(await patchIntegrationSettings('i-1', {})).toEqual({ ok: false, error: 'network_error' })
  })
})

describe('putOutboundSecret', () => {
  it('PUTs the secret and returns last4 + updatedAt on 200 (never the plaintext back)', async () => {
    const fetchMock = mockFetch(200, { last4: 'wxyz', updatedAt: '2026-09-10T00:00:00Z' })
    const result = await putOutboundSecret('i-1', 'a'.repeat(20))
    expect(result).toEqual({ ok: true, last4: 'wxyz', updatedAt: '2026-09-10T00:00:00Z' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/dashboard/pos-integrations/i-1/outbound-secret')
    expect(init).toMatchObject({ method: 'PUT' })
  })

  it('surfaces secret_too_short on 422', async () => {
    mockFetch(422, { error: 'secret_too_short' })
    expect(await putOutboundSecret('i-1', 'short')).toEqual({ ok: false, error: 'secret_too_short' })
  })
})

describe('rotateInboundSecretRequest', () => {
  it('POSTs with no body and returns the one-time webhookSecret on 200', async () => {
    const fetchMock = mockFetch(200, { webhookSecret: 'new-secret-value' })
    const result = await rotateInboundSecretRequest('i-1')
    expect(result).toEqual({ ok: true, webhookSecret: 'new-secret-value' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/dashboard/pos-integrations/i-1/rotate-inbound-secret')
    expect(init).toMatchObject({ method: 'POST' })
  })

  it('surfaces a 403 error for staff', async () => {
    mockFetch(403, { error: 'Forbidden' })
    expect(await rotateInboundSecretRequest('i-1')).toEqual({ ok: false, error: 'Forbidden' })
  })
})

describe('sendTestEventRequest', () => {
  it('POSTs and returns the deliveryId on 202', async () => {
    mockFetch(202, { deliveryId: 'd-1' })
    await expect(sendTestEventRequest('i-1')).resolves.toEqual({ ok: true, deliveryId: 'd-1' })
  })

  it.each(['url_not_saved', 'not_eligible_for_delivery'])('surfaces %s on 422', async (code) => {
    mockFetch(422, { error: code })
    expect(await sendTestEventRequest('i-1')).toEqual({ ok: false, status: 422, error: code })
  })

  it('surfaces integration_not_found on 404', async () => {
    mockFetch(404, { error: 'integration_not_found' })
    expect(await sendTestEventRequest('i-1')).toEqual({ ok: false, status: 404, error: 'integration_not_found' })
  })
})

describe('isTenantAdmin', () => {
  it('is true when the active restaurant role is admin', () => {
    expect(isTenantAdmin([{ id: 'r-1', role: 'admin' }, { id: 'r-2', role: 'staff' }], 'r-1')).toBe(true)
  })

  it('is false when the active restaurant role is staff', () => {
    expect(isTenantAdmin([{ id: 'r-1', role: 'staff' }], 'r-1')).toBe(false)
  })

  it('is false when restaurantId is null', () => {
    expect(isTenantAdmin([{ id: 'r-1', role: 'admin' }], null)).toBe(false)
  })

  it('is false when restaurantId is not in the list', () => {
    expect(isTenantAdmin([{ id: 'r-1', role: 'admin' }], 'r-9')).toBe(false)
  })
})

// INT-001 WI-10 — frozen acceptance suite (authored before delivery-log-
// table.tsx / activity-log-table.tsx / paused-banner.tsx, from the WI-8
// route contracts, matching WI-9's own disclosed derive-first posture).

const DELIVERY = {
  id: 'd-1',
  eventId: 'evt-1',
  eventType: 'member.created' as const,
  occurredAt: '2026-09-10T00:00:00Z',
  status: 'dead_lettered' as const,
  attempts: 5,
  lastHttpStatus: 404,
  lastErrorCode: 'http_4xx',
  nextRetryAt: null,
  createdAt: '2026-09-10T00:00:00Z',
}

describe('fetchIntegrationDeliveries', () => {
  it('returns { data, nextCursor } on 200 with no query params when none given', async () => {
    const fn = mockFetch(200, { data: [DELIVERY], nextCursor: null })
    await expect(fetchIntegrationDeliveries('i-1')).resolves.toEqual({
      ok: true,
      data: [DELIVERY],
      nextCursor: null,
    })
    expect(fn).toHaveBeenCalledWith('/api/dashboard/pos-integrations/i-1/deliveries')
  })

  it('appends status and cursor as query params when given', async () => {
    const fn = mockFetch(200, { data: [], nextCursor: 'c-2' })
    await fetchIntegrationDeliveries('i-1', { status: 'dead_lettered', cursor: 'c-1' })
    expect(fn).toHaveBeenCalledWith('/api/dashboard/pos-integrations/i-1/deliveries?status=dead_lettered&cursor=c-1')
  })

  it('defaults nextCursor to null and data to [] on a malformed body', async () => {
    mockFetch(200, {})
    await expect(fetchIntegrationDeliveries('i-1')).resolves.toEqual({ ok: true, data: [], nextCursor: null })
  })

  it('carries the HTTP status through on a non-ok response (staff -> 403)', async () => {
    mockFetch(403, { error: 'Forbidden' })
    await expect(fetchIntegrationDeliveries('i-1')).resolves.toEqual({ ok: false, status: 403, error: 'Forbidden' })
  })

  it('returns network_error (status 0) when fetch throws', async () => {
    mockFetchThrows()
    await expect(fetchIntegrationDeliveries('i-1')).resolves.toEqual({ ok: false, status: 0, error: 'network_error' })
  })
})

describe('retryDeliveryRequest', () => {
  it('POSTs and returns ok:true on 202', async () => {
    const fn = mockFetch(202, { status: 'ok' })
    await expect(retryDeliveryRequest('i-1', 'd-1')).resolves.toEqual({ ok: true })
    expect(fn).toHaveBeenCalledWith('/api/dashboard/pos-integrations/i-1/deliveries/d-1/retry', { method: 'POST' })
  })

  it('surfaces already_retried on 409', async () => {
    mockFetch(409, { error: 'already_retried' })
    await expect(retryDeliveryRequest('i-1', 'd-1')).resolves.toEqual({
      ok: false,
      status: 409,
      error: 'already_retried',
    })
  })

  it('surfaces not_found on 404 (foreign/absent delivery)', async () => {
    mockFetch(404, { error: 'not_found' })
    await expect(retryDeliveryRequest('i-1', 'd-9')).resolves.toEqual({ ok: false, status: 404, error: 'not_found' })
  })

  it('returns network_error when fetch throws', async () => {
    mockFetchThrows()
    await expect(retryDeliveryRequest('i-1', 'd-1')).resolves.toEqual({ ok: false, status: 0, error: 'network_error' })
  })
})

const ACTIVITY_ITEM = {
  jobId: 'job-1',
  status: 'succeeded' as const,
  outcome: 'created' as const,
  assertedLevel: 'all' as const,
  consentActions: { utility: 'opted_in', marketing: 'opted_in' },
  welcomeOutcome: 'sent',
  welcomeDetail: { whatsapp_message_id: 'wamid.1' },
  phoneLast4: '1234',
  submittedAt: '2026-09-10T00:00:00Z',
}

describe('fetchIntegrationActivity', () => {
  it('returns { data, nextCursor } on 200 with no query params when none given', async () => {
    const fn = mockFetch(200, { data: [ACTIVITY_ITEM], nextCursor: null })
    await expect(fetchIntegrationActivity('i-1')).resolves.toEqual({
      ok: true,
      data: [ACTIVITY_ITEM],
      nextCursor: null,
    })
    expect(fn).toHaveBeenCalledWith('/api/dashboard/pos-integrations/i-1/activity')
  })

  it('appends cursor as a query param when given', async () => {
    const fn = mockFetch(200, { data: [], nextCursor: null })
    await fetchIntegrationActivity('i-1', { cursor: '2026-09-01T00:00:00Z' })
    expect(fn).toHaveBeenCalledWith(
      '/api/dashboard/pos-integrations/i-1/activity?cursor=2026-09-01T00%3A00%3A00Z'
    )
  })

  it('carries the HTTP status through on a non-ok response (staff -> 403)', async () => {
    mockFetch(403, { error: 'Forbidden' })
    await expect(fetchIntegrationActivity('i-1')).resolves.toEqual({ ok: false, status: 403, error: 'Forbidden' })
  })

  it('returns network_error (status 0) when fetch throws', async () => {
    mockFetchThrows()
    await expect(fetchIntegrationActivity('i-1')).resolves.toEqual({ ok: false, status: 0, error: 'network_error' })
  })
})

describe('resumeOutboundRequest', () => {
  it('POSTs with no body and returns requeued on 200', async () => {
    const fn = mockFetch(200, { requeued: 37 })
    await expect(resumeOutboundRequest('i-1')).resolves.toEqual({ ok: true, requeued: 37 })
    expect(fn).toHaveBeenCalledWith('/api/dashboard/pos-integrations/i-1/outbound/resume', { method: 'POST' })
  })

  it('defaults requeued to 0 on a malformed body', async () => {
    mockFetch(200, {})
    await expect(resumeOutboundRequest('i-1')).resolves.toEqual({ ok: true, requeued: 0 })
  })

  it('surfaces url_invalid on 422 (must fix URL before resuming)', async () => {
    mockFetch(422, { error: 'url_invalid' })
    await expect(resumeOutboundRequest('i-1')).resolves.toEqual({ ok: false, status: 422, error: 'url_invalid' })
  })

  it('surfaces integration_not_found on 404', async () => {
    mockFetch(404, { error: 'integration_not_found' })
    await expect(resumeOutboundRequest('i-1')).resolves.toEqual({
      ok: false,
      status: 404,
      error: 'integration_not_found',
    })
  })

  it('returns network_error when fetch throws', async () => {
    mockFetchThrows()
    await expect(resumeOutboundRequest('i-1')).resolves.toEqual({ ok: false, status: 0, error: 'network_error' })
  })
})
