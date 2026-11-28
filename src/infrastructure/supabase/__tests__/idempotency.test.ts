import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../client'
import { tryMarkProcessed, releaseIdempotencyKey } from '../idempotency'
import type { LogFn } from '@/domain/ports/whatsapp-webhooks'

interface MockBuilder {
  insertResult: { error: null | { code: string; message: string } }
  deleteResult: { error: null | { code: string; message: string } }
  insertCalls: Array<Record<string, unknown>>
  deleteEqCalls: Array<{ column: string; value: unknown }>
}

function buildMockSupabase(state: MockBuilder) {
  return {
    from: vi.fn(() => ({
      insert: vi.fn(async (row: Record<string, unknown>) => {
        state.insertCalls.push(row)
        return state.insertResult
      }),
      delete: vi.fn(() => ({
        eq: vi.fn(async (column: string, value: unknown) => {
          state.deleteEqCalls.push({ column, value })
          return state.deleteResult
        }),
      })),
    })),
  }
}

function makeState(overrides: Partial<MockBuilder> = {}): MockBuilder {
  return {
    insertResult: { error: null },
    deleteResult: { error: null },
    insertCalls: [],
    deleteEqCalls: [],
    ...overrides,
  }
}

describe('tryMarkProcessed', () => {
  let logs: Array<[string, string, unknown]>
  const log: LogFn = (level, event, data) => {
    logs.push([level, event, data])
  }

  beforeEach(() => {
    vi.clearAllMocks()
    logs = []
  })

  it("returns 'new' on a successful insert", async () => {
    const state = makeState()
    vi.mocked(createServerSupabaseClient).mockReturnValue(
      buildMockSupabase(state) as never
    )

    const result = await tryMarkProcessed('wamid.X:sent', log)

    expect(result).toBe('new')
    expect(state.insertCalls).toEqual([{ idempotency_key: 'wamid.X:sent' }])
    expect(logs[0][0]).toBe('info')
    expect(logs[0][1]).toBe('webhook.idempotency')
  })

  it("returns 'duplicate' on PG 23505 unique-violation", async () => {
    const state = makeState({
      insertResult: { error: { code: '23505', message: 'duplicate key' } },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(
      buildMockSupabase(state) as never
    )

    const result = await tryMarkProcessed('wamid.X:delivered', log)

    expect(result).toBe('duplicate')
    expect(logs[0][2]).toMatchObject({ status: 'duplicate' })
  })

  it("returns 'error' on other database errors and logs them", async () => {
    const state = makeState({
      insertResult: { error: { code: '08006', message: 'connection lost' } },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(
      buildMockSupabase(state) as never
    )

    const result = await tryMarkProcessed('wamid.X:read', log)

    expect(result).toBe('error')
    expect(logs[0][0]).toBe('error')
  })
})

describe('releaseIdempotencyKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes the row keyed by idempotency_key', async () => {
    const state = makeState()
    vi.mocked(createServerSupabaseClient).mockReturnValue(
      buildMockSupabase(state) as never
    )

    await releaseIdempotencyKey('wamid.X:sent')

    expect(state.deleteEqCalls).toEqual([
      { column: 'idempotency_key', value: 'wamid.X:sent' },
    ])
  })

  it('throws when the delete itself errors so the caller can decide', async () => {
    const state = makeState({
      deleteResult: { error: { code: '08006', message: 'connection lost' } },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(
      buildMockSupabase(state) as never
    )

    await expect(releaseIdempotencyKey('wamid.X:sent')).rejects.toThrow(
      /releaseIdempotencyKey/
    )
  })
})
