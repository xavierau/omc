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
  restaurant_id: string
  member_id: string | null
  campaign_id: string | null
  phone_e164: string
  direction: string
  category: string
  message_type: string
  template_id: string | null
  template_name: string | null
  content_preview: string | null
  kapso_message_id: string | null
  status: string
  queued_at: string
  sent_at: string | null
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

interface EventRow extends Record<string, unknown> {
  restaurant_id: string
  type: string
  data_json: Record<string, unknown>
}

const state = {
  messages: new Map<string, Row>(),
  processed: new Set<string>(),
  members: new Map<string, MemberRow>(),
  events: [] as EventRow[],
  // When set, the next processed_webhooks insert returns this error (transient
  // DB failure simulation for the idempotency-error path).
  processedInsertError: null as { code: string; message: string } | null,
}

function reset(): void {
  state.messages.clear()
  state.processed.clear()
  state.members.clear()
  state.events.length = 0
  state.processedInsertError = null
}

function seedMessage(row: Partial<Row> & { id: string; kapso_message_id: string }): void {
  state.messages.set(row.id, {
    restaurant_id: 'rest-1',
    member_id: null,
    campaign_id: null,
    phone_e164: '85299999999',
    direction: 'outbound',
    category: 'marketing',
    message_type: 'template',
    template_id: null,
    template_name: null,
    content_preview: null,
    status: 'sent',
    queued_at: '2026-05-04T09:59:00.000Z',
    sent_at: '2026-05-04T09:59:30.000Z',
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
      if (table === 'events') return eventsOps()
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
  // The dispatcher's writers chain:
  //   markMemberUnreachable: .from('members').update(...).eq('id', X)            -> resolves
  //   throttleMemberPmm:     .from('members').update(...).eq('id', X).or(expr)   -> resolves
  // We expose a thenable on every node so the test does not care which step is
  // terminal. The OR expression is parsed only enough to honour the
  // "do not regress longer cooldown" guard.
  function applyUpdate(patch: Partial<MemberRow>, id: string, orExpr?: string) {
    const row = state.members.get(id)
    if (!row) return
    if (orExpr && 'pmm_throttled_until' in patch) {
      const guard = parseThrottleGuard(orExpr)
      const newUntil = patch.pmm_throttled_until as string
      const current = row.pmm_throttled_until
      if (current !== null && current >= newUntil && guard) return
    }
    Object.assign(row, patch)
  }
  function chain(patch: Partial<MemberRow>): unknown {
    let id: string | null = null
    let orExpr: string | undefined
    const node: Record<string, unknown> = {}
    node.eq = (col: string, val: string) => {
      if (col === 'id') id = val
      return node
    }
    node.or = (expr: string) => {
      orExpr = expr
      return node
    }
    node.then = (
      onFulfilled: (v: { error: null }) => unknown,
      onRejected?: (e: unknown) => unknown
    ) => {
      if (id) applyUpdate(patch, id, orExpr)
      return Promise.resolve({ error: null }).then(onFulfilled, onRejected)
    }
    return node
  }
  return {
    select: () => ({
      eq: (_col: string, value: string) => ({
        maybeSingle: async () => ({
          data: state.members.get(value) ?? null,
          error: null,
        }),
      }),
    }),
    update: (patch: Partial<MemberRow>) => chain(patch),
  }
}

function parseThrottleGuard(expr: string): boolean {
  // We only check for the addendum's required form; if it's missing, we
  // refuse the regression-guard fast-path so the test signals the drift.
  return (
    expr.includes('pmm_throttled_until.is.null') &&
    expr.includes('pmm_throttled_until.lt.')
  )
}

function eventsOps() {
  return {
    insert: async (row: EventRow) => {
      state.events.push(row)
      return { error: null }
    },
  }
}

vi.mock('@/infrastructure/supabase/client', () => ({
  createServerSupabaseClient: vi.fn(() => fakeSupabase()),
}))

const ORIGINAL_SECRET = process.env.KAPSO_WEBHOOK_SECRET

beforeAll(() => {
  delete process.env.KAPSO_WEBHOOK_SECRET
  // NODE_ENV is left untouched: vitest 4 marks process.env.NODE_ENV as
  // non-configurable, so any redefine via Object.defineProperty throws.
  // Tests already run with NODE_ENV='test' which keeps verifySignature in
  // demo mode (the secret short-circuit).
})

afterAll(() => {
  if (ORIGINAL_SECRET !== undefined) {
    process.env.KAPSO_WEBHOOK_SECRET = ORIGINAL_SECRET
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
    // Pin raw_status_payload write — guards against a future refactor
    // silently dropping the JSONB column update.
    expect(row.raw_status_payload).not.toBeNull()
    expect(row.raw_status_payload).toMatchObject({
      id: KAPSO_DELIVERED_ID,
      status: 'delivered',
    })
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

  it('failed/131049 populates error fields AND sets members.pmm_throttled_until ~24h ahead (WAQ-003 wired)', async () => {
    seedMessage({
      id: 'msg-2',
      kapso_message_id: KAPSO_FAILED_ID,
      member_id: 'mem-1',
    } as unknown as Partial<Row> & { id: string; kapso_message_id: string })
    seedMember('mem-1')
    const fixture = loadFixture('kapso-status-failed-131049.json')

    const before = Date.now()
    const { status } = await postWebhook(fixture)
    const after = Date.now()

    expect(status).toBe(200)
    const row = state.messages.get('msg-2')!
    expect(row.status).toBe('failed')
    expect(row.error_code).toBe('131049')
    expect(row.error_title).toContain('Per-user marketing limit')
    expect(row.error_details).toContain('PMM')
    expect(row.failed_at).toBeTruthy()

    // WAQ-003: 131049 sets pmm_throttled_until ~24h ahead.
    const throttled = state.members.get('mem-1')!.pmm_throttled_until
    expect(throttled).not.toBeNull()
    const throttledMs = Date.parse(throttled as string)
    expect(throttledMs).toBeGreaterThanOrEqual(before + 24 * 3600_000 - 1000)
    expect(throttledMs).toBeLessThanOrEqual(after + 24 * 3600_000 + 1000)

    // 131026 is the unreachable signal — must NOT be set on a 131049.
    expect(state.members.get('mem-1')!.unreachable_at).toBeNull()

    // 131049 is throttle_recipient_24h, NOT an alert class. No events row.
    expect(state.events).toHaveLength(0)
  })

  it('failed/131026 sets members.unreachable_at and does NOT throttle PMM', async () => {
    seedMessage({
      id: 'msg-3',
      kapso_message_id: 'wamid.WAQ003_FAILED_131026',
      member_id: 'mem-2',
    } as unknown as Partial<Row> & { id: string; kapso_message_id: string })
    seedMember('mem-2')
    const fixture = loadFixture('kapso-status-failed-131026.json')

    const { status } = await postWebhook(fixture)

    expect(status).toBe(200)
    const row = state.messages.get('msg-3')!
    expect(row.status).toBe('failed')
    expect(row.error_code).toBe('131026')

    expect(state.members.get('mem-2')!.unreachable_at).not.toBeNull()
    expect(state.members.get('mem-2')!.pmm_throttled_until).toBeNull()
    expect(state.events).toHaveLength(0)
  })

  it('failed/132100 emits a whatsapp_error events row (policy_violation_alert) and does NOT mutate members', async () => {
    seedMessage({
      id: 'msg-4',
      kapso_message_id: 'wamid.WAQ003_FAILED_132100',
      member_id: 'mem-3',
    } as unknown as Partial<Row> & { id: string; kapso_message_id: string })
    seedMember('mem-3')
    const fixture = loadFixture('kapso-status-failed-132100.json')

    const { status } = await postWebhook(fixture)

    expect(status).toBe(200)
    expect(state.messages.get('msg-4')!.error_code).toBe('132100')

    // No member-state mutation for the policy violation class.
    expect(state.members.get('mem-3')!.pmm_throttled_until).toBeNull()
    expect(state.members.get('mem-3')!.unreachable_at).toBeNull()

    // events row recorded for ops triage.
    expect(state.events).toHaveLength(1)
    expect(state.events[0]).toMatchObject({
      restaurant_id: 'rest-1',
      type: 'whatsapp_error',
      data_json: expect.objectContaining({
        kind: 'policy_violation_alert',
        error_code: '132100',
        action: 'policy_violation_alert',
      }),
    })
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
