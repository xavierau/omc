import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import { listCampaignsUsingTemplate } from '../template-review-detail-queries'

const ROW = {
  id: 'camp-1',
  name: 'Birthday',
  type: 'birthday',
  status: 'active',
  target_audience: null,
  coupon_config: null,
  schedule: { trigger: 'birthday', daysBefore: 3 },
  scheduled_at: null,
  created_at: '2026-10-31T00:00:00Z',
}

function client(rows: unknown[]) {
  const selects: string[] = []
  const from = vi.fn(() => {
    const chain: Record<string, unknown> = {}
    chain.select = vi.fn((cols: string) => { selects.push(cols); return chain })
    chain.eq = vi.fn(() => chain)
    chain.order = vi.fn(() => chain)
    chain.limit = vi.fn(() => Promise.resolve({ data: rows, error: null }))
    return chain
  })
  vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as never)
  return { selects }
}

beforeEach(() => vi.clearAllMocks())

describe('listCampaignsUsingTemplate', () => {
  it('selects the schedule column and maps rows through mapRowToCampaign (only the panel fields)', async () => {
    const { selects } = client([ROW])
    const [c] = await listCampaignsUsingTemplate('rest-1', 'tpl-1')

    expect(selects[0]).toContain('schedule')
    expect(c).toEqual({
      id: 'camp-1',
      name: 'Birthday',
      type: 'birthday',
      status: 'active',
      targetAudience: 'all',
      couponConfig: null,
      schedule: { trigger: 'birthday', daysBefore: 3 },
      scheduledAt: null,
      createdAt: '2026-10-31T00:00:00Z',
    })
  })
})
