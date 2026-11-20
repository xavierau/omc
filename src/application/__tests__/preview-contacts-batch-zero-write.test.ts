/**
 * QA (acceptance) — A19 / T-B5.6 at the level the plan actually specifies:
 * "a test that fails if the preview path issues any insert/update/upsert/
 * delete/rpc".
 *
 * The dev-authored zero-write test asserts on the two repository functions in
 * isolation (import-preview-lookups.test.ts). This one drives the REAL
 * `previewContactsBatch` entry point with only the Supabase client mocked, so
 * a future write introduced anywhere in the preview path — the use case, the
 * lookup orchestrator, or either repository — fails here.
 *
 * Added by qa-engineer during acceptance verification; not part of the frozen
 * dev suite.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { previewContactsBatch } from '../preview-contacts-batch'

const RESTAURANT_ID = 'rest-1'

const writeSpies = {
  insert: vi.fn(),
  update: vi.fn(),
  upsert: vi.fn(),
  delete: vi.fn(),
  rpc: vi.fn(),
}

/** Recording client: every write verb is a spy, every read verb chains. */
function makeRecordingClient(rowsByTable: Record<string, unknown[]>) {
  const from = vi.fn((table: string) => {
    const resolved = { data: rowsByTable[table] ?? [], error: null }
    const chain: Record<string, unknown> = {}
    for (const verb of ['select', 'eq', 'in', 'or', 'order', 'limit', 'neq', 'gte', 'lte']) {
      chain[verb] = vi.fn(() => chain)
    }
    chain.then = (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve(resolved).then(onFulfilled)
    chain.insert = writeSpies.insert
    chain.update = writeSpies.update
    chain.upsert = writeSpies.upsert
    chain.delete = writeSpies.delete
    return chain
  })
  return { from, rpc: writeSpies.rpc } as unknown as ReturnType<
    typeof createServerSupabaseClient
  >
}

const METADATA = {
  source: 'walk-in sign-up sheet',
  dateRangeStart: new Date('2026-01-01T00:00:00Z'),
  dateRangeEnd: new Date('2026-06-01T00:00:00Z'),
  consentTextShown: 'I agree to receive marketing messages on WhatsApp.',
  consentChannel: 'generic' as const,
  proofUrl: null,
}

describe('previewContactsBatch — whole-path zero-write assertion (A19, T-B5.6)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createServerSupabaseClient).mockReturnValue(
      makeRecordingClient({
        members: [{ phone: '+85291234567' }],
        consent_records: [{ phone_e164: '+85291234568' }],
      })
    )
  })

  it('never issues insert/update/upsert/delete/rpc anywhere in the preview path', async () => {
    const result = await previewContactsBatch({
      restaurantId: RESTAURANT_ID,
      metadata: METADATA,
      rows: [
        { phoneE164: '+852 9123 4567', name: 'A', tags: ['VIP'] },
        { phoneE164: '+85291234568', name: 'B', tags: ['vip', 'lunch'] },
        { phoneE164: 'not-a-phone', name: 'C', tags: ['ignored'] },
        { phoneE164: '+85291234568', name: 'D' },
      ],
      now: new Date('2026-06-02T00:00:00Z'),
    })

    // Sanity: the path really ran (otherwise the assertion below is vacuous).
    expect(result.rows).toHaveLength(2)
    expect(result.rejected.map((r) => r.reason)).toEqual([
      'invalid_phone',
      'duplicate_phone_in_batch',
    ])
    expect(result.lookups.status).toBe('ok')
    expect(result.lookups.alreadyMemberPhones).toEqual(['+85291234567'])
    expect(result.lookups.activeConsentPhones).toEqual(['+85291234568'])

    expect(writeSpies.insert).not.toHaveBeenCalled()
    expect(writeSpies.update).not.toHaveBeenCalled()
    expect(writeSpies.upsert).not.toHaveBeenCalled()
    expect(writeSpies.delete).not.toHaveBeenCalled()
    expect(writeSpies.rpc).not.toHaveBeenCalled()
  })

  it('a rejected row contributes no phone to the lookups (T-B1.11 / A6 at the path level)', async () => {
    await previewContactsBatch({
      restaurantId: RESTAURANT_ID,
      metadata: METADATA,
      rows: [
        { phoneE164: '+85291234567', tags: ['vip'] },
        { phoneE164: 'not-a-phone', tags: ['vip'] },
      ],
      now: new Date('2026-06-02T00:00:00Z'),
    })

    const client = vi.mocked(createServerSupabaseClient).mock.results[0]
      ?.value as { from: ReturnType<typeof vi.fn> }
    // Both lookups run; neither may carry the rejected raw string.
    for (const call of client.from.mock.results) {
      const chain = call.value as { in: ReturnType<typeof vi.fn> }
      for (const [, values] of chain.in.mock.calls) {
        if (Array.isArray(values)) {
          expect(values).not.toContain('not-a-phone')
        }
      }
    }
  })
})
