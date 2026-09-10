import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../pos-event-listener', () => ({
  createPosEventListener: vi.fn(),
}))

import {
  registerListenerFactory,
  resolveListener,
} from '../listener-registry'
import type { EventListenerPort } from '@/domain/ports/event-listener'

describe('listener-registry', () => {
  const stubListener: EventListenerPort = {
    supportedEvents: ['join'],
    handle: vi.fn(),
  }

  describe('registerListenerFactory + resolveListener', () => {
    beforeEach(() => {
      registerListenerFactory('test', () => stubListener)
    })

    it('returns EventListenerPort for a registered prefix', () => {
      const listener = resolveListener('test:some-id')

      expect(listener).toBe(stubListener)
    })

    it('passes the id portion after the colon to the factory', () => {
      const factory = vi.fn().mockReturnValue(stubListener)
      registerListenerFactory('custom', factory)

      resolveListener('custom:abc-123')

      expect(factory).toHaveBeenCalledWith('abc-123')
    })
  })

  describe('unknown prefix', () => {
    it('throws Error with message containing the prefix', () => {
      expect(() => resolveListener('unknown:some-id')).toThrow(
        'Unknown listener prefix: "unknown"'
      )
    })
  })

  describe('key parsing', () => {
    it('splits on first colon only, preserving colons in the id', () => {
      const factory = vi.fn().mockReturnValue(stubListener)
      registerListenerFactory('pos', factory)

      resolveListener('pos:some-uuid-with:colons:inside')

      expect(factory).toHaveBeenCalledWith(
        'some-uuid-with:colons:inside'
      )
    })
  })

  describe('invalid key format', () => {
    it('throws when key has no colon', () => {
      expect(() => resolveListener('no-colon-here')).toThrow(
        'Invalid listener key format: "no-colon-here"'
      )
    })
  })
})
