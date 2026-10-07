import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the supabase client BEFORE importing the repository.
vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { upsertCommissions } from '../referrer-commission-repository'
import { createServerSupabaseClient } from '../../client'

const mockCreateClient = vi.mocked(createServerSupabaseClient)

type PaidRow = { referrer_id: string; month: string; tenant_id: string }
type UpsertResult = { error: { message: string } | null }

/**
 * Build a fake supabase client with independent queues for:
 *   - paidRowsSequence: successive responses for fetchPaidKeys (.select chain)
 *   - upsertResults:    successive responses for upsert()
 *
 * Each call to from() returns a builder with BOTH chains available, but only
 * consumes an item from the queue actually used (so mis-aligned sequences
 * can't happen). Counts are tracked per-operation.
 */
function buildFakeClient(
  paidRowsSequence: Array<PaidRow[]>,
  upsertResults: Array<UpsertResult>
) {
  const counters = { selects: 0, upserts: 0, fromCalls: 0 }

  const from = vi.fn(() => {
    counters.fromCalls++

    const select = vi.fn(() => {
      const paidRows = paidRowsSequence[counters.selects++] ?? []
      const inChain2 = vi
        .fn()
        .mockResolvedValue({ data: paidRows, error: null })
      const inChain1 = vi.fn(() => ({ in: inChain2 }))
      const eqChain = vi.fn(() => ({ in: inChain1 }))
      return { eq: eqChain }
    })

    const upsert = vi.fn().mockImplementation(() => {
      const result = upsertResults[counters.upserts++] ?? { error: null }
      return Promise.resolve(result)
    })

    return { select, upsert }
  })

  return { from, _counters: counters }
}

function sampleInput() {
  return {
    referrerId: 'ref-1',
    month: '2026-04',
    tenantId: 'tenant-1',
    tenantName: 'Sushi Bar',
    messagesSent: 100,
    redemptionsCount: 10,
    commissionPerMessage: 0.05,
    commissionPerRedemption: 0.1,
    broadcastCommission: 5,
    redemptionCommission: 1,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('upsertCommissions', () => {
  it('does nothing for empty input', async () => {
    await upsertCommissions([])
    expect(mockCreateClient).not.toHaveBeenCalled()
  })

  it('upserts filtered rows on happy path', async () => {
    const client = buildFakeClient([[]], [{ error: null }])
    mockCreateClient.mockReturnValue(
      client as unknown as ReturnType<typeof createServerSupabaseClient>
    )

    await upsertCommissions([sampleInput()])

    expect(client._counters.selects).toBe(1) // fetchPaidKeys
    expect(client._counters.upserts).toBe(1) // single upsert
  })

  it('retries once when the paid-row trigger fires (TOCTOU race)', async () => {
    // First attempt: empty paid set → upsert returns trigger error.
    // Retry: re-fetch paid keys (now includes the row) → filter removes it
    //   → upsert skipped, treated as success.
    const triggerError = {
      message: 'Cannot modify a paid commission record (id: abc-123)',
    }
    const client = buildFakeClient(
      [
        [], // first fetchPaidKeys: row still pending
        [{ referrer_id: 'ref-1', month: '2026-04', tenant_id: 'tenant-1' }],
      ],
      [{ error: triggerError }]
    )
    mockCreateClient.mockReturnValue(
      client as unknown as ReturnType<typeof createServerSupabaseClient>
    )

    await expect(upsertCommissions([sampleInput()])).resolves.toBeUndefined()

    // fetchPaidKeys called twice, upsert called once
    expect(client._counters.selects).toBe(2)
    expect(client._counters.upserts).toBe(1)
  })

  it('retries once when race window stayed open (retried upsert succeeds)', async () => {
    // Both attempts see empty paid set. First upsert hits trigger, retry
    // upsert succeeds (DB resolved the race some other way).
    const triggerError = {
      message: 'Cannot modify a paid commission record (id: abc-123)',
    }
    const client = buildFakeClient(
      [[], []], // paid set empty both times
      [{ error: triggerError }, { error: null }]
    )
    mockCreateClient.mockReturnValue(
      client as unknown as ReturnType<typeof createServerSupabaseClient>
    )

    await expect(upsertCommissions([sampleInput()])).resolves.toBeUndefined()

    expect(client._counters.selects).toBe(2)
    expect(client._counters.upserts).toBe(2)
  })

  it('throws when retry also hits the paid-row trigger', async () => {
    const triggerError = {
      message: 'Cannot modify a paid commission record (id: abc-123)',
    }
    const client = buildFakeClient(
      [[], []],
      [{ error: triggerError }, { error: triggerError }]
    )
    mockCreateClient.mockReturnValue(
      client as unknown as ReturnType<typeof createServerSupabaseClient>
    )

    await expect(upsertCommissions([sampleInput()])).rejects.toThrow(
      /Cannot modify a paid commission record/
    )
    expect(client._counters.upserts).toBe(2)
  })

  it('does not retry on non-trigger errors — throws immediately', async () => {
    const genericError = { message: 'connection reset by peer' }
    const client = buildFakeClient([[]], [{ error: genericError }])
    mockCreateClient.mockReturnValue(
      client as unknown as ReturnType<typeof createServerSupabaseClient>
    )

    await expect(upsertCommissions([sampleInput()])).rejects.toThrow(
      /connection reset by peer/
    )
    // Only one upsert attempt (no retry)
    expect(client._counters.upserts).toBe(1)
    expect(client._counters.selects).toBe(1)
  })
})
