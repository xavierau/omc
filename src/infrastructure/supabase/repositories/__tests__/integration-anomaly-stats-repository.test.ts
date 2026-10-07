import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import { findIntegrationVolumeAnomalies } from '../integration-anomaly-stats-repository'

function mockRows(rows: Array<{ integration_id: string; restaurant_id: string; submitted_at: string }>) {
  const gte = vi.fn().mockResolvedValue({ data: rows, error: null })
  const eq = vi.fn().mockReturnValue({ gte })
  const select = vi.fn().mockReturnValue({ eq })
  const from = vi.fn().mockReturnValue({ select })
  vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as unknown as ReturnType<
    typeof createServerSupabaseClient
  >)
}

describe('findIntegrationVolumeAnomalies (T-M2)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('flags an integration whose last-hour volume exceeds 3x its 7-day hourly baseline', async () => {
    const now = Date.now()
    const rows: Array<{ integration_id: string; restaurant_id: string; submitted_at: string }> = []
    // Last hour: 20 rows for int-hot.
    for (let i = 0; i < 20; i++) {
      rows.push({ integration_id: 'int-hot', restaurant_id: 'r-1', submitted_at: new Date(now - i * 1000).toISOString() })
    }
    // Prior 6 days 23 hours (167 hours): 167 rows -> baseline exactly 1/hr.
    for (let i = 0; i < 167; i++) {
      rows.push({
        integration_id: 'int-hot',
        restaurant_id: 'r-1',
        submitted_at: new Date(now - (2 + i) * 60 * 60 * 1000).toISOString(),
      })
    }
    mockRows(rows)

    const anomalies = await findIntegrationVolumeAnomalies({ multiplier: 3, minLastHourVolume: 10 })

    expect(anomalies).toHaveLength(1)
    expect(anomalies[0]).toMatchObject({ integrationId: 'int-hot', restaurantId: 'r-1', lastHourCount: 20 })
  })

  it('does not flag an integration under the minimum volume floor, even at a huge multiple', async () => {
    const now = Date.now()
    // 2 in the last hour vs 0 baseline -- technically "infinite" ratio, but below the volume floor.
    mockRows([
      { integration_id: 'int-quiet', restaurant_id: 'r-1', submitted_at: new Date(now).toISOString() },
      { integration_id: 'int-quiet', restaurant_id: 'r-1', submitted_at: new Date(now - 1000).toISOString() },
    ])

    const anomalies = await findIntegrationVolumeAnomalies({ multiplier: 3, minLastHourVolume: 10 })
    expect(anomalies).toEqual([])
  })

  it('does not flag steady, proportionate volume', async () => {
    const now = Date.now()
    const rows: Array<{ integration_id: string; restaurant_id: string; submitted_at: string }> = []
    for (let i = 0; i < 10; i++) {
      rows.push({ integration_id: 'int-steady', restaurant_id: 'r-1', submitted_at: new Date(now - i * 1000).toISOString() })
    }
    for (let i = 0; i < 1670; i++) {
      rows.push({
        integration_id: 'int-steady',
        restaurant_id: 'r-1',
        submitted_at: new Date(now - (2 + (i % 167)) * 60 * 60 * 1000).toISOString(),
      })
    }
    mockRows(rows)

    const anomalies = await findIntegrationVolumeAnomalies({ multiplier: 3, minLastHourVolume: 10 })
    expect(anomalies).toEqual([])
  })

  it('throws a contextual error on a database failure', async () => {
    const gte = vi.fn().mockResolvedValue({ data: null, error: { message: 'timeout' } })
    const eq = vi.fn().mockReturnValue({ gte })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as unknown as ReturnType<
      typeof createServerSupabaseClient
    >)

    await expect(findIntegrationVolumeAnomalies({ multiplier: 3, minLastHourVolume: 10 })).rejects.toThrow(
      /findIntegrationVolumeAnomalies.*timeout/
    )
  })
})
