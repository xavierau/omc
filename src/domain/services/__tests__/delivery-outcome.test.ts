import { describe, expect, it } from 'vitest'
import type { DeliveryResult } from '@/domain/ports/outbound-webhook-sender'
import { classifyDeliveryOutcome } from '../delivery-outcome'

function result(overrides: Partial<DeliveryResult>): DeliveryResult {
  return { ok: false, status: null, latencyMs: 1, responseExcerpt: null, ...overrides }
}

describe('classifyDeliveryOutcome', () => {
  it.each([200, 201, 204, 299])('2xx (%i) -> delivered', (status) => {
    expect(classifyDeliveryOutcome(result({ ok: true, status }))).toBe('delivered')
  })

  it.each([300, 301, 404, 400, 403])('3xx/4xx except 408/429 (%i) -> permanent', (status) => {
    expect(classifyDeliveryOutcome(result({ status }))).toBe('permanent')
  })

  it.each([408, 429])('%i -> transient', (status) => {
    expect(classifyDeliveryOutcome(result({ status }))).toBe('transient')
  })

  it.each([500, 502, 503, 599])('5xx (%i) -> transient', (status) => {
    expect(classifyDeliveryOutcome(result({ status }))).toBe('transient')
  })

  it.each(['ssrf_rejected', 'invalid_url', 'signature_missing', 'secret_missing'])(
    'no status + error.title=%s -> permanent',
    (title) => {
      expect(
        classifyDeliveryOutcome(result({ status: null, error: { title } }))
      ).toBe('permanent')
    }
  )

  it.each(['timeout', 'dns_error', 'connection_reset', 'network_error'])(
    'no status + error.title=%s -> transient',
    (title) => {
      expect(
        classifyDeliveryOutcome(result({ status: null, error: { title } }))
      ).toBe('transient')
    }
  )

  it('no status + unrecognised error title -> transient (fail closed toward retry)', () => {
    expect(
      classifyDeliveryOutcome(result({ status: null, error: { title: 'mystery' } }))
    ).toBe('transient')
  })

  it('no status + no error -> transient', () => {
    expect(classifyDeliveryOutcome(result({ status: null }))).toBe('transient')
  })
})
