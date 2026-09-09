import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import { recordIntegrationSettingsAudit } from '../integration-settings-audit-repository'

describe('recordIntegrationSettingsAudit', () => {
  beforeEach(() => vi.clearAllMocks())

  it('inserts a full audit row', async () => {
    const inserted: { value: Record<string, unknown> | null } = { value: null }
    const insert = vi.fn().mockImplementation((row: Record<string, unknown>) => {
      inserted.value = row
      return Promise.resolve({ data: null, error: null })
    })
    const from = vi.fn().mockReturnValue({ insert })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      from,
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    await recordIntegrationSettingsAudit({
      integrationId: 'int-1',
      restaurantId: 'r-1',
      actorUserId: 'user-1',
      field: 'outboundUrl',
      oldValue: null,
      newValue: 'https://partner.example.com/hook',
    })

    expect(inserted.value).toMatchObject({
      integration_id: 'int-1',
      restaurant_id: 'r-1',
      actor_user_id: 'user-1',
      field: 'outboundUrl',
      old_value: null,
      new_value: 'https://partner.example.com/hook',
    })
    expect(inserted.value?.id).toEqual(expect.any(String))
  })

  it('throws a contextual error on a database failure', async () => {
    const insert = vi.fn().mockResolvedValue({ data: null, error: { message: 'db down' } })
    const from = vi.fn().mockReturnValue({ insert })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      from,
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    await expect(
      recordIntegrationSettingsAudit({
        integrationId: 'int-1',
        restaurantId: 'r-1',
        actorUserId: null,
        field: 'x',
        oldValue: null,
        newValue: null,
      })
    ).rejects.toThrow(/recordIntegrationSettingsAudit.*db down/)
  })
})
