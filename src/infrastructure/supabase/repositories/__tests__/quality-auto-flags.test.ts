import { describe, it, expect, vi, beforeEach } from 'vitest'

const upsertSpy = vi.fn()

vi.mock('../../client', () => ({
  createServerSupabaseClient: () => ({
    from: () => ({
      upsert: (row: Record<string, unknown>, opts: Record<string, unknown>) => {
        upsertSpy(row, opts)
        return Promise.resolve({ error: null })
      },
    }),
  }),
}))

import {
  applyAutoThrottle,
  applyAutoPause,
  clearAutoQualityFlags,
} from '../quality-auto-flags'

beforeEach(() => {
  upsertSpy.mockClear()
})

describe('applyAutoThrottle', () => {
  it('upserts auto_throttle_factor and stamps set_at', async () => {
    await applyAutoThrottle('rest-1', 0.5)
    expect(upsertSpy).toHaveBeenCalledTimes(1)
    const [row, opts] = upsertSpy.mock.calls[0]
    expect(row.restaurant_id).toBe('rest-1')
    expect(row.auto_throttle_factor).toBe(0.5)
    expect(row.auto_pause_set_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    )
    expect(opts).toEqual({ onConflict: 'restaurant_id' })
  })
})

describe('applyAutoPause', () => {
  it('upserts auto_pause_active=true with the supplied reason', async () => {
    await applyAutoPause('rest-1', 'quality_red_auto')
    const [row] = upsertSpy.mock.calls[0]
    expect(row).toMatchObject({
      restaurant_id: 'rest-1',
      auto_pause_active: true,
      auto_pause_reason: 'quality_red_auto',
    })
    expect(row.auto_pause_set_at).toBeTypeOf('string')
  })
})

describe('clearAutoQualityFlags', () => {
  it('resets factor to 1 and clears the pause flag + reason', async () => {
    await clearAutoQualityFlags('rest-1')
    const [row] = upsertSpy.mock.calls[0]
    expect(row).toEqual({
      restaurant_id: 'rest-1',
      auto_throttle_factor: 1,
      auto_pause_active: false,
      auto_pause_reason: null,
      auto_pause_set_at: null,
    })
  })
})

describe('error propagation', () => {
  it('throws when supabase returns an error', async () => {
    const failing = vi.fn(() =>
      Promise.resolve({ error: { message: 'boom' } as { message: string } })
    )
    vi.doMock('../../client', () => ({
      createServerSupabaseClient: () => ({
        from: () => ({ upsert: failing }),
      }),
    }))
    vi.resetModules()
    const fresh = await import('../quality-auto-flags')
    await expect(fresh.applyAutoPause('rest-1', 'quality_red_auto')).rejects.toThrow(
      /auto-flags upsert: boom/
    )
    vi.doUnmock('../../client')
  })
})
