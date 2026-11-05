import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/pos-integration-repository')
import { findPosIntegrationById } from '@/infrastructure/supabase/repositories/pos-integration-repository'
import {
  getSupportedEventsForProvider,
  createPosEventListener,
} from '../pos-event-listener'
import { buildPosIntegration } from '@/test-utils/builders'
import type { DomainEvent } from '@/domain/ports/event-listener'

function buildDomainEvent(
  overrides: Partial<DomainEvent> = {}
): DomainEvent {
  return {
    id: 'event-1',
    restaurantId: 'restaurant-1',
    memberId: 'member-1',
    type: 'join',
    dataJson: {},
    createdAt: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('pos-event-listener', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getSupportedEventsForProvider', () => {
    it('returns empty array for generic provider', () => {
      expect(getSupportedEventsForProvider('generic')).toEqual([])
    })

    it('returns empty array for ichef (no adapter yet)', () => {
      expect(getSupportedEventsForProvider('ichef')).toEqual([])
    })

    it('returns empty array for square provider', () => {
      expect(getSupportedEventsForProvider('square')).toEqual([])
    })

    it('returns empty array for unknown provider', () => {
      expect(getSupportedEventsForProvider('unknown')).toEqual([])
    })
  })

  describe('createPosEventListener', () => {
    it('has empty supportedEvents array', () => {
      const listener = createPosEventListener('pos-integration-1')

      expect(listener.supportedEvents).toEqual([])
    })

    it('calls findPosIntegrationById on handle', async () => {
      const integration = buildPosIntegration({ provider: 'generic' })
      vi.mocked(findPosIntegrationById).mockResolvedValue(integration)

      const listener = createPosEventListener('pos-integration-1')
      await listener.handle(buildDomainEvent())

      expect(findPosIntegrationById).toHaveBeenCalledWith(
        'pos-integration-1'
      )
    })

    it('throws when integration not found', async () => {
      vi.mocked(findPosIntegrationById).mockResolvedValue(null)

      const listener = createPosEventListener('missing-id')

      await expect(listener.handle(buildDomainEvent())).rejects.toThrow(
        'POS integration not found: missing-id'
      )
    })
  })
})
