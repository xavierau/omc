import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/integration-settings-repository')
vi.mock('@/infrastructure/supabase/repositories/integration-settings-audit-repository')

import {
  findIntegrationSettingsById,
  setOutboundSecret as persistOutboundSecret,
} from '@/infrastructure/supabase/repositories/integration-settings-repository'
import { recordIntegrationSettingsAudit } from '@/infrastructure/supabase/repositories/integration-settings-audit-repository'
import { setOutboundSecret } from '../set-outbound-secret'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('setOutboundSecret', () => {
  it('rejects a secret shorter than 16 characters, persists nothing', async () => {
    const result = await setOutboundSecret('int-1', 'rest-1', 'tooshort', 'user-1')
    expect(result).toEqual({ ok: false, error: 'secret_too_short' })
    expect(persistOutboundSecret).not.toHaveBeenCalled()
    expect(recordIntegrationSettingsAudit).not.toHaveBeenCalled()
  })

  it('rejects a non-string value', async () => {
    const result = await setOutboundSecret('int-1', 'rest-1', 12345678901234567890, 'user-1')
    expect(result).toEqual({ ok: false, error: 'secret_too_short' })
  })

  it('saves a valid secret and returns only last4, never the plaintext', async () => {
    vi.mocked(findIntegrationSettingsById).mockResolvedValue(null)
    vi.mocked(persistOutboundSecret).mockResolvedValue({ last4: 'wxyz', updatedAt: '2026-09-10T00:00:00Z' })

    const result = await setOutboundSecret('int-1', 'rest-1', 'a-partner-minted-secret-value', 'user-1')

    expect(result).toEqual({ ok: true, last4: 'wxyz', updatedAt: '2026-09-10T00:00:00Z' })
    expect(JSON.stringify(result)).not.toContain('a-partner-minted-secret-value')
  })

  it('writes an audit row carrying only last4 (old and new), never the plaintext or ciphertext', async () => {
    vi.mocked(findIntegrationSettingsById).mockResolvedValue({
      snapshot: { outboundSecretLast4: 'oldx' },
    } as never)
    vi.mocked(persistOutboundSecret).mockResolvedValue({ last4: 'newy', updatedAt: '2026-09-10T00:00:00Z' })

    await setOutboundSecret('int-1', 'rest-1', 'a-partner-minted-secret-value', 'user-1')

    expect(recordIntegrationSettingsAudit).toHaveBeenCalledWith({
      integrationId: 'int-1',
      restaurantId: 'rest-1',
      actorUserId: 'user-1',
      field: 'outboundSecret',
      oldValue: 'oldx',
      newValue: 'newy',
    })
    const auditCall = vi.mocked(recordIntegrationSettingsAudit).mock.calls[0][0]
    expect(JSON.stringify(auditCall)).not.toContain('a-partner-minted-secret-value')
  })
})
