import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/infrastructure/supabase/client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { reconcileOrphanMessages } from '../reconcile-orphan-messages'

interface QueryRecorder {
  status: string | null
  kapsoNull: boolean
  cutoffLt: string | null
  update: Record<string, unknown> | null
}

function buildSupabase(rowsToReturn: Array<{ id: string }>): {
  client: ReturnType<typeof createServerSupabaseClient>
  recorder: QueryRecorder
} {
  const recorder: QueryRecorder = {
    status: null,
    kapsoNull: false,
    cutoffLt: null,
    update: null,
  }
  const select = vi.fn().mockResolvedValue({ data: rowsToReturn, error: null })
  const lt = vi.fn().mockImplementation((_col: string, val: string) => {
    recorder.cutoffLt = val
    return { select }
  })
  const isNull = vi.fn().mockImplementation((_col: string, val: null) => {
    recorder.kapsoNull = val === null
    return { lt }
  })
  const eq = vi.fn().mockImplementation((_col: string, val: string) => {
    recorder.status = val
    return { is: isNull }
  })
  const update = vi.fn().mockImplementation((u: Record<string, unknown>) => {
    recorder.update = u
    return { eq }
  })
  const from = vi.fn().mockReturnValue({ update })
  return {
    client: { from } as unknown as ReturnType<typeof createServerSupabaseClient>,
    recorder,
  }
}

const FIXED_NOW = new Date('2026-05-04T10:00:00.000Z')

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('reconcileOrphanMessages', () => {
  it('flips queued rows older than 5 minutes to failed/internal_orphan', async () => {
    const { client, recorder } = buildSupabase([{ id: 'a' }, { id: 'b' }])
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const result = await reconcileOrphanMessages()

    expect(result).toEqual({ swept: 2 })
    expect(recorder.status).toBe('queued')
    expect(recorder.kapsoNull).toBe(true)
    // 5-minute cutoff: now - 5min = 09:55:00
    expect(recorder.cutoffLt).toBe('2026-05-04T09:55:00.000Z')
    expect(recorder.update).toMatchObject({
      status: 'failed',
      failed_at: FIXED_NOW.toISOString(),
      error_code: 'internal_orphan',
    })
  })

  it('returns swept=0 when nothing matches', async () => {
    const { client } = buildSupabase([])
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const result = await reconcileOrphanMessages()

    expect(result).toEqual({ swept: 0 })
  })

  it('verifies a 6-minute-old queued row is swept (acceptance per addendum §6.4)', async () => {
    // Acceptance criterion: a row stuck at queued for 6 minutes flips to
    // failed/internal_orphan. The 5-minute cutoff means anything older
    // than 09:55:00 is swept; 6 minutes ago = 09:54:00 < 09:55:00 (Yes).
    const { client, recorder } = buildSupabase([{ id: 'six-min-old' }])
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const result = await reconcileOrphanMessages()

    expect(result.swept).toBe(1)
    const cutoffMs = Date.parse(recorder.cutoffLt!)
    const sixMinutesAgoMs = FIXED_NOW.getTime() - 6 * 60_000
    expect(sixMinutesAgoMs).toBeLessThan(cutoffMs)
  })

  it('throws when the database returns an error', async () => {
    const select = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } })
    const lt = vi.fn().mockReturnValue({ select })
    const isNull = vi.fn().mockReturnValue({ lt })
    const eq = vi.fn().mockReturnValue({ is: isNull })
    const update = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ update })
    vi.mocked(createServerSupabaseClient).mockReturnValue(
      { from } as unknown as ReturnType<typeof createServerSupabaseClient>
    )

    await expect(reconcileOrphanMessages()).rejects.toThrow(
      'reconcileOrphanMessages: boom'
    )
  })
})
