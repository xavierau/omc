import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/pos-integration-repository')

import {
  createPosIntegration,
  updatePosIntegration,
  deletePosIntegration,
  findPosIntegrationsByRestaurant,
} from '@/infrastructure/supabase/repositories/pos-integration-repository'
import {
  createIntegration,
  updateIntegration,
  deleteIntegration,
  listIntegrations,
  regenerateWebhookSecret,
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
        updateIntegration('id-1', {
          fieldMapping: { bad: true } as never,
        })
      ).rejects.toThrow('Invalid field mapping')
    })

    it('delegates to repository', async () => {
      vi.mocked(updatePosIntegration).mockResolvedValue(undefined)

      await updateIntegration('id-1', { name: 'Updated' })

      expect(updatePosIntegration).toHaveBeenCalledWith('id-1', { name: 'Updated' })
    })
  })

  describe('deleteIntegration', () => {
    it('delegates to repository', async () => {
      vi.mocked(deletePosIntegration).mockResolvedValue(undefined)

      await deleteIntegration('id-1')

      expect(deletePosIntegration).toHaveBeenCalledWith('id-1')
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
})
