import { describe, expect, it } from 'vitest'
import {
  IntegrationDelivery,
  type IntegrationDeliveryProps,
  type IntegrationDeliveryStatus,
} from '../integration-delivery'

function baseProps(overrides: Partial<IntegrationDeliveryProps> = {}): IntegrationDeliveryProps {
  return {
    id: 'del-1',
    integrationId: 'int-1',
    restaurantId: 'r-1',
    eventId: 'evt_1',
    status: 'queued',
    attempts: 0,
    lastHttpStatus: null,
    lastErrorCode: null,
    lastLatencyMs: null,
    responseExcerpt: null,
    nextRetryAt: null,
    enqueuedAt: null,
    deliveredAt: null,
    deadLetteredAt: null,
    retriedAt: null,
    ...overrides,
  }
}

const VALID: Array<[IntegrationDeliveryStatus, IntegrationDeliveryStatus]> = [
  ['queued', 'delivering'],
  ['queued', 'paused'],
  ['queued', 'skipped'],
  ['delivering', 'delivered'],
  ['delivering', 'retrying'],
  ['delivering', 'dead_lettered'],
  ['retrying', 'delivering'],
  ['retrying', 'dead_lettered'],
  ['paused', 'queued'],
  ['dead_lettered', 'queued'],
]

const INVALID: Array<[IntegrationDeliveryStatus, IntegrationDeliveryStatus]> = [
  ['queued', 'delivered'],
  ['delivered', 'queued'],
  ['delivered', 'delivering'],
  ['skipped', 'queued'],
  ['paused', 'delivering'],
  ['dead_lettered', 'delivering'],
]

describe('IntegrationDelivery transitions', () => {
  it.each(VALID)('%s -> %s is allowed', (from, to) => {
    const delivery = IntegrationDelivery.fromProps(baseProps({ status: from }))
    expect(delivery.canTransitionTo(to)).toBe(true)
    expect(delivery.transitionTo(to).snapshot.status).toBe(to)
  })

  it.each(INVALID)('%s -> %s is rejected', (from, to) => {
    const delivery = IntegrationDelivery.fromProps(baseProps({ status: from }))
    expect(delivery.canTransitionTo(to)).toBe(false)
    expect(() => delivery.transitionTo(to)).toThrow(/invalid transition/)
  })

  it('transitionTo never mutates the original instance', () => {
    const delivery = IntegrationDelivery.fromProps(baseProps({ status: 'queued' }))
    const next = delivery.transitionTo('delivering')
    expect(delivery.snapshot.status).toBe('queued')
    expect(next.snapshot.status).toBe('delivering')
  })

  it('transitionTo merges the given patch', () => {
    const delivery = IntegrationDelivery.fromProps(baseProps({ status: 'delivering', attempts: 1 }))
    const next = delivery.transitionTo('retrying', { attempts: 2, lastHttpStatus: 503 })
    expect(next.snapshot).toMatchObject({ status: 'retrying', attempts: 2, lastHttpStatus: 503 })
  })

  it('delivered and skipped are terminal', () => {
    expect(IntegrationDelivery.fromProps(baseProps({ status: 'delivered' })).isTerminal()).toBe(true)
    expect(IntegrationDelivery.fromProps(baseProps({ status: 'skipped' })).isTerminal()).toBe(true)
    expect(IntegrationDelivery.fromProps(baseProps({ status: 'queued' })).isTerminal()).toBe(false)
  })
})
