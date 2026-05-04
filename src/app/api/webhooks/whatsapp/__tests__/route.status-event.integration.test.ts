/**
 * Integration test for WAQ-002 status webhook routing. Posts real-shaped
 * Kapso payloads to the route handler and asserts row updates and
 * idempotency through a hand-rolled in-memory Supabase mock.
 *
 * Auth: KAPSO_WEBHOOK_SECRET is unset so verifySignature returns true via
 * the demo-mode short-circuit (see route.ts:verifySignature).
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  beforeAll,
  afterAll,
} from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

vi.mock('@/infrastructure/whatsapp/provider-factory', async () => {
  const actual = await vi.importActual<
    typeof import('@/infrastructure/whatsapp/provider-factory')
  >('@/infrastructure/whatsapp/provider-factory')
  return actual
})
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository', () => ({
  findByPhoneNumberId: vi.fn(),
  getRestaurantPhoneNumberId: vi.fn(),
}))

import { findByPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'

// In-memory Supabase mock: the test owns rows for `whatsapp_messages` and
// `processed_webhooks`. The route + repository code reaches into
// createServerSupabaseClient() and we intercept that to talk to this state.
interface Row extends Record<string, unknown> {
  id: string
  kapso_message_id: string | null
  status: string
  delivered_at: string | null
  read_at: string | null
  failed_at: string | null
  error_code: string | null
  error_title: string | null
  error_details: string | null
  raw_status_payload: Record<string, unknown> | null
}

interface MemberRow extends Record<string, unknown> {
  id: string
  pmm_throttled_until: string | null
  unreachable_at: string | null
}

const state = {
  messages: new Map<string, Row>(),
  processed: new Set<string>(),
  members: new Map<string, MemberRow>(),
  // When set, the next processed_webhooks insert returns this error (transient
  // DB failure simulation for the idempotency-error path).
  processedInsertError: null as { code: string; message: string } | null,
}

function reset(): void {
  state.messages.clear()
  state.processed.clear()
  state.members.clear()
  state.processedInsertError = null
}

function seedMessage(row: Partial<Row> & { id: string; kapso_message_id: string }): void {
  state.messages.set(row.id, {
    status: 'sent',
    delivered_at: null,
    read_at: null,
    failed_at: null,
    error_code: null,
    error_title: null,
    error_details: null,
    raw_status_payload: null,
    ...row,
  } as Row)
}

function seedMember(id: string): void {
  state.members.set(id, {
    id,
    pmm_throttled_until: null,
    unreachable_at: null,
  })
}

function fakeSupabase() {
  return {
    from(table: string) {
      if (table === 'processed_webhooks') return processedWebhooksOps()
      if (table === 'whatsapp_messages') return whatsappMessagesOps()
      if (table === 'members') return membersOps()
      throw new Error(`unexpected table: ${table}`)
    },
  }
}

function processedWebhooksOps() {
  return {
    insert: async (row: { idempotency_key: string }) => {
      if (state.processedInsertError) {
        const err = state.processedInsertError
        state.processedInsertError = null
        return { error: err }
      }
      if (state.processed.has(row.idempotency_key)) {
        return { error: { code: '23505', message: 'duplicate key' } }
      }
      state.processed.add(row.idempotency_key)
      return { error: null }
    },
    delete: () => ({
      eq: async (column: string, value: string) => {
        if (column === 'idempotency_key') state.processed.delete(value)
        return { error: null }
      },
    }),
  }
}

function whatsappMessagesOps() {
  return {
    select: () => ({
      eq: (_col: string, value: string) => ({
        maybeSingle: async () => {
          for (const row of state.messages.values()) {
            if (row.kapso_message_id === value) return { data: row, error: null }
          }
          return { data: null, error: null }
        },
      }),
    }),
    update: (patch: Partial<Row>) => ({
      eq: async (col: string, value: string) => {
        for (const row of state.messages.values()) {
          if ((row as Record<string, unknown>)[col] === value) {
            Object.assign(row, patch)
          }
        }
        return { error: null }
      },
    }),
  }
}

function membersOps() {
  return {
    select: () => ({
      eq: (_col: string, value: string) => ({
        maybeSingle: async () => ({
          data: state.members.get(value) ?? null,
          error: null,
        }),
      }),
    }),
  }
}

vi.mock('@/infrastructure/supabase/client', () => ({
  createServerSupabaseClient: vi.fn(() => fakeSupabase()),
}))

const ORIGINAL_SECRET = process.env.KAPSO_WEBHOOK_SECRET
const ORIGINAL_NODE_ENV = process.env.NODE_ENV

beforeAll(() => {
  delete process.env.KAPSO_WEBHOOK_SECRET
  // Keep NODE_ENV unset / non-production so missing secret short-circuits
  // verifySignature to true.
  if (ORIGINAL_NODE_ENV === 'production') {
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'test' })
  }
})

afterAll(() => {
  if (ORIGINAL_SECRET !== undefined) {
    process.env.KAPSO_WEBHOOK_SECRET = ORIGINAL_SECRET
  }
  if (ORIGINAL_NODE_ENV !== undefined) {
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: ORIGINAL_NODE_ENV,
    })
  }
})

beforeEach(() => {
  reset()
  vi.clearAllMocks()
  vi.mocked(findByPhoneNumberId).mockResolvedValue({
    id: 'rest-1',
  } as never)
})

function loadFixture(name: string): unknown {
  const file = path.join(
    __dirname,
    '../../../../../../docs/playbooks/fixtures',
    name
  )
  return JSON.parse(readFileSync(file, 'utf-8'))
}

async function postWebhook(body: unknown): Promise<{
  status: number
  json: Record<string, unknown>
}> {
  const { POST } = await import('../route')
  const req = new Request('http://localhost/api/webhooks/whatsapp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  // Next's NextRequest accepts a Request; cast here keeps the test ergonomic.
  const res = await POST(req as never)
  return { status: res.status, json: await res.json() }
}

const KAPSO_DELIVERED_ID = 'wamid.WAQ002_DELIVERED'
const KAPSO_FAILED_ID = 'wamid.WAQ002_FAILED'

describe('POST /api/webhooks/whatsapp — status events', () => {
  it('updates a sent row to delivered and sets delivered_at and processed_webhooks key', async () => {
    seedMessage({ id: 'msg-1', kapso_message_id: KAPSO_DELIVERED_ID })
    const fixture = loadFixture('kapso-status-delivered.json')

    const { status, json } = await postWebhook(fixture)

    expect(status).toBe(200)
    expect(json).toEqual({ status: 'ok' })
    const row = state.messages.get('msg-1')!
    expect(row.status).toBe('delivered')
    expect(row.delivered_at).toBeTruthy()
    expect(state.processed.has(`${KAPSO_DELIVERED_ID}:delivered`)).toBe(true)
  })

  it('re-POSTing the identical payload no-ops via idempotency claim', async () => {
    seedMessage({ id: 'msg-1', kapso_message_id: KAPSO_DELIVERED_ID })
    const fixture = loadFixture('kapso-status-delivered.json')

    await postWebhook(fixture)
    const firstDeliveredAt = state.messages.get('msg-1')!.delivered_at

    // Second POST: row should be untouched (no second update)
    const { status } = await postWebhook(fixture)

    expect(status).toBe(200)
    expect(state.messages.get('msg-1')!.delivered_at).toBe(firstDeliveredAt)
  })

  it('failed payload populates error_code/error_title/error_details and does NOT mutate members.pmm_throttled_until', async () => {
    seedMessage({ id: 'msg-2', kapso_message_id: KAPSO_FAILED_ID })
    seedMember('mem-1')
    const fixture = loadFixture('kapso-status-failed-131049.json')

    const { status } = await postWebhook(fixture)

    expect(status).toBe(200)
    const row = state.messages.get('msg-2')!
    expect(row.status).toBe('failed')
    expect(row.error_code).toBe('131049')
    expect(row.error_title).toContain('Per-user marketing limit')
    expect(row.error_details).toContain('PMM')
    expect(row.failed_at).toBeTruthy()

    // WAQ-003 boundary: WAQ-002 must NOT touch members.pmm_throttled_until.
    expect(state.members.get('mem-1')!.pmm_throttled_until).toBeNull()
    expect(state.members.get('mem-1')!.unreachable_at).toBeNull()
  })

  it('progresses delivered -> read on the same row', async () => {
    seedMessage({
      id: 'msg-1',
      kapso_message_id: KAPSO_DELIVERED_ID,
      status: 'delivered',
      delivered_at: '2026-05-04T10:00:02.000Z',
    })
    const fixture = loadFixture('kapso-status-read.json')

    await postWebhook(fixture)

    const row = state.messages.get('msg-1')!
    expect(row.status).toBe('read')
    expect(row.read_at).toBeTruthy()
  })

  it('returns 500 when idempotency claim fails transiently so Kapso retries', async () => {
    seedMessage({ id: 'msg-1', kapso_message_id: KAPSO_DELIVERED_ID })
    state.processedInsertError = {
      code: '08006',
      message: 'connection_failure',
    }
    const fixture = loadFixture('kapso-status-delivered.json')

    const { status, json } = await postWebhook(fixture)

    // route.ts top-level catch turns the re-thrown idempotency error into 500.
    expect(status).toBe(500)
    expect(json).toMatchObject({ error: 'Internal error' })
    // Side effects must NOT have happened.
    expect(state.messages.get('msg-1')!.status).toBe('sent')
    expect(state.messages.get('msg-1')!.delivered_at).toBeNull()
    expect(state.processed.has(`${KAPSO_DELIVERED_ID}:delivered`)).toBe(false)
  })

  it('unknown kapso id: 200, logs unknown_message, releases idempotency key so retry succeeds after the row appears', async () => {
    const fixture = loadFixture('kapso-status-delivered.json')

    const { status: firstStatus } = await postWebhook(fixture)
    expect(firstStatus).toBe(200)

    // Idempotency key must be released so a future attempt can claim it.
    expect(state.processed.has(`${KAPSO_DELIVERED_ID}:delivered`)).toBe(false)

    // Now the row is seeded (simulating recordOutboundSend finally landing).
    seedMessage({ id: 'msg-late', kapso_message_id: KAPSO_DELIVERED_ID })

    const { status: secondStatus } = await postWebhook(fixture)
    expect(secondStatus).toBe(200)
    expect(state.messages.get('msg-late')!.status).toBe('delivered')
  })
})
