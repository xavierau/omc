import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import { getStampCapPolicy } from '../platform-settings-repository'

function buildSelectClient(
  result: { data: unknown; error: { message: string } | null }
) {
  const single = vi.fn().mockResolvedValue(result)
  const select = vi.fn().mockReturnValue({ single })
  const from = vi.fn().mockReturnValue({ select })
  return { from, select, single }
}

describe('getStampCapPolicy', () => {
  beforeEach(() => vi.clearAllMocks())

  it('maps the persisted single-row policy', async () => {
    const client = buildSelectClient({
      data: { stamp_cap_enforcement: 'block', stamp_cap_warn_threshold: 3 },
      error: null,
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: client.from } as never)

    const policy = await getStampCapPolicy()

    expect(policy).toEqual({ enforcement: 'block', warnThreshold: 3 })
    expect(client.from).toHaveBeenCalledWith('platform_settings')
  })

  it('falls back to the safe founder default (warn, threshold 1) when the row is absent', async () => {
    const client = buildSelectClient({ data: null, error: { message: 'no rows' } })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: client.from } as never)

    const policy = await getStampCapPolicy()

    expect(policy).toEqual({ enforcement: 'warn', warnThreshold: 1 })
  })
})
