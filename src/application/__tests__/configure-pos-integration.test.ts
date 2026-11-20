import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/pos-integration-repository')

import {
  createPosIntegration,
  updatePosIntegration,
  deletePosIntegration,
  findPosIntegrationsByRestaurant,
  findPosIntegrationByIdForRestaurant,
} from '@/infrastructure/supabase/repositories/pos-integration-repository'
import {
  createIntegration,
  updateIntegration,
  deleteIntegration,
  listIntegrations,
  getIntegration,
  regenerateWebhookSecret,
  rotateInboundSecret,
} from '../configure-pos-integration'
import { buildPosFieldMapping } from '@/test-utils/builders'

describe('configure-pos-integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createPosIntegration).mockResolvedValue('new-id-1')
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
  })

  describe('createIntegration', () => {
    it('generates webhookSecret, webhookUrl, and returns id', async () => {
      const result = await createIntegration({
        restaurantId: 'rest-1',
        name: 'My POS',
      })

      expect(result.id).toBe('new-id-1')
      expect(result.webhookSecret).toHaveLength(64) // 32 bytes hex
      expect(result.webhookUrl).toBe('https://app.example.com/api/webhooks/pos/new-id-1')
      expect(createPosIntegration).toHaveBeenCalledWith(
        expect.objectContaining({
          restaurantId: 'rest-1',
          provider: 'generic',
          name: 'My POS',
          status: 'active',
        })
      )
    })

    it('throws on invalid fieldMapping', async () => {
      await expect(
        createIntegration({
          restaurantId: 'rest-1',
          name: 'Bad POS',
          fieldMapping: { transactionId: '$.id' } as never,
        })
      ).rejects.toThrow('Invalid field mapping')
    })

    it('accepts valid fieldMapping', async () => {
      const mapping = buildPosFieldMapping()

      const result = await createIntegration({
        restaurantId: 'rest-1',
        name: 'Good POS',
        fieldMapping: mapping,
      })

      expect(result.id).toBe('new-id-1')
      expect(createPosIntegration).toHaveBeenCalledWith(
        expect.objectContaining({ fieldMapping: mapping })
      )
    })
  })

  describe('updateIntegration', () => {
    it('throws on invalid fieldMapping', async () => {
      await expect(
        updateIntegration('id-1', 'rest-1', {
          fieldMapping: { bad: true } as never,
        })
      ).rejects.toThrow('Invalid field mapping')
    })

    it('delegates to repository, scoped by restaurantId (G-5, SEC-001/#111 pattern)', async () => {
      vi.mocked(updatePosIntegration).mockResolvedValue(undefined)

      await updateIntegration('id-1', 'rest-1', { name: 'Updated' })

      expect(updatePosIntegration).toHaveBeenCalledWith('id-1', 'rest-1', { name: 'Updated' })
    })

    it('never forwards webhookSecret to the repository, even if smuggled onto the updates object at runtime (T-C4 defense in depth)', async () => {
      vi.mocked(updatePosIntegration).mockResolvedValue(undefined)

      // Simulates a caller that bypasses the route-level allowlist and the
      // TS parameter type (erased at runtime) by attaching an extra key.
      const smuggled = { name: 'Updated', webhookSecret: 'attacker-chosen-secret' } as never

      await updateIntegration('id-1', 'rest-1', smuggled)

      expect(updatePosIntegration).toHaveBeenCalledWith('id-1', 'rest-1', { name: 'Updated' })
      const [, , forwarded] = vi.mocked(updatePosIntegration).mock.calls[0]
      expect(forwarded).not.toHaveProperty('webhookSecret')
    })
  })

  describe('deleteIntegration', () => {
    it('delegates to repository, scoped by restaurantId (G-5, SEC-001/#111 pattern)', async () => {
      vi.mocked(deletePosIntegration).mockResolvedValue(undefined)

      await deleteIntegration('id-1', 'rest-1')

      expect(deletePosIntegration).toHaveBeenCalledWith('id-1', 'rest-1')
    })
  })

  describe('listIntegrations', () => {
    it('returns results from repository', async () => {
      const mockData = [{ id: 'int-1' }, { id: 'int-2' }]
      vi.mocked(findPosIntegrationsByRestaurant).mockResolvedValue(mockData as never)

      const result = await listIntegrations('rest-1')

      expect(result).toEqual(mockData)
      expect(findPosIntegrationsByRestaurant).toHaveBeenCalledWith('rest-1')
    })
  })

  describe('regenerateWebhookSecret', () => {
    it('returns a 64-char hex string', () => {
      const secret = regenerateWebhookSecret()

      expect(secret).toHaveLength(64)
      expect(/^[0-9a-f]+$/.test(secret)).toBe(true)
    })
  })

  describe('getIntegration', () => {
    it('delegates to the restaurant-scoped repository query (issue #111 lesson — not fetch-then-compare)', async () => {
      const mockIntegration = { id: 'int-1', restaurantId: 'rest-1' }
      vi.mocked(findPosIntegrationByIdForRestaurant).mockResolvedValue(mockIntegration as never)

      const result = await getIntegration('int-1', 'rest-1')

      expect(result).toEqual(mockIntegration)
      expect(findPosIntegrationByIdForRestaurant).toHaveBeenCalledWith('int-1', 'rest-1')
    })

    it('returns null for a foreign-tenant id', async () => {
      vi.mocked(findPosIntegrationByIdForRestaurant).mockResolvedValue(null)

      const result = await getIntegration('int-1', 'rest-2')

      expect(result).toBeNull()
    })
  })

  describe('rotateInboundSecret', () => {
    it('mints a new secret, persists it scoped by restaurantId (G-5, SEC-001/#111 pattern), and returns it once', async () => {
      vi.mocked(updatePosIntegration).mockResolvedValue(undefined)
      vi.spyOn(console, 'info').mockImplementation(() => {})

      const secret = await rotateInboundSecret('int-1', 'rest-1', 'user-1')

      expect(secret).toHaveLength(64)
      expect(/^[0-9a-f]+$/.test(secret)).toBe(true)
      expect(updatePosIntegration).toHaveBeenCalledWith('int-1', 'rest-1', { webhookSecret: secret })
    })

    it('logs the rotation (WI-0 console audit placeholder; WI-1 adds the DB row)', async () => {
      vi.mocked(updatePosIntegration).mockResolvedValue(undefined)
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      await rotateInboundSecret('int-1', 'rest-1', 'user-1')

      expect(infoSpy).toHaveBeenCalledWith(
        'pos_integration.inbound_secret_rotated',
        expect.objectContaining({ integrationId: 'int-1', rotatedBy: 'user-1' })
      )
    })
  })
})
