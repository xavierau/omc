import { describe, it, expect } from 'vitest'
import { toPublicIntegration } from '../public-integration'
import type { PosIntegration } from '@/domain/entities/pos-integration'

const ALLOWED_KEYS = [
  'id',
  'restaurantId',
  'provider',
  'name',
  'status',
  'fieldMapping',
  'secretLast4',
  'createdAt',
  'updatedAt',
].sort()

const INTEGRATION: PosIntegration = {
  id: 'int-1',
  restaurantId: 'rest-1',
  provider: 'ichef',
  name: 'My POS',
  status: 'active',
  webhookSecret: 'a'.repeat(60) + 'beef',
  fieldMapping: null,
  credentials: { apiKey: 'super-secret-api-key' },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

describe('toPublicIntegration', () => {
  it('exposes exactly the allowlisted keys — fails on any new key leaking through', () => {
    const result = toPublicIntegration(INTEGRATION)

    expect(Object.keys(result).sort()).toEqual(ALLOWED_KEYS)
  })

  it('never includes webhookSecret or credentials', () => {
    const result = toPublicIntegration(INTEGRATION) as unknown as Record<string, unknown>

    expect(result.webhookSecret).toBeUndefined()
    expect(result.credentials).toBeUndefined()
    expect(JSON.stringify(result)).not.toContain('super-secret-api-key')
    expect(JSON.stringify(result)).not.toContain(INTEGRATION.webhookSecret)
  })

  it('derives secretLast4 from the last 4 chars of webhookSecret', () => {
    const result = toPublicIntegration(INTEGRATION)

    expect(result.secretLast4).toBe('beef')
  })

  it('returns null secretLast4 when there is no webhookSecret', () => {
    const result = toPublicIntegration({ ...INTEGRATION, webhookSecret: null })

    expect(result.secretLast4).toBeNull()
  })
})
