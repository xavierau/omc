/**
 * WAQ-006 integration: posts synthetic Meta account_quality_update fixtures
 * to the route handler and asserts:
 *   - tenant_quality_state row inserted with correct quality_rating + tier
 *   - same-second repeat POST is idempotent (no second insert)
 *   - WAQ-002 status flow still works (regression)
 *   - WAQ-002 inbound flow still works (regression)
 *
 * Auth: KAPSO_WEBHOOK_SECRET unset so verifySignature returns true via
 * the demo-mode short-circuit (mirrors route.status-event.integration.test.ts).
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
  findByDisplayPhoneNumber: vi.fn(),
  getRestaurantPhoneNumberId: vi.fn(),
}))

import {
  findByDisplayPhoneNumber,
  findByPhoneNumberId,
} from '@/infrastructure/supabase/repositories/restaurant-repository'

interface QualityRow extends Record<string, unknown> {
  id: string
  restaurant_id: string
  phone_number_id: string | null
  display_phone_number: string | null
  quality_rating: string
  messaging_tier: string | null
  flagged: boolean
  raw_payload: Record<string, unknown> | null
  transitioned_at: string
}

interface MessageRow extends Record<string, unknown> {
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

const state = {
  qualityEvents: [] as QualityRow[],
  messages: new Map<string, MessageRow>(),
  members: new Map<string, MemberRow>(),
  processed: new Set<string>(),
  inbound: [] as Array<Record<string, unknown>>,
}

function reset(): void {
  state.qualityEvents.length = 0
  state.messages.clear()
  state.members.clear()
  state.processed.clear()
  state.inbound.length = 0
}

function seedMessage(row: Partial<MessageRow> & { id: string; kapso_message_id: string }): void {
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
  } as MessageRow)
}

function fakeSupabase() {
  return {
    from(table: string) {
      if (table === 'tenant_quality_state') return qualityOps()
      if (table === 'processed_webhooks') return processedOps()
      if (table === 'whatsapp_messages') return messagesOps()
      if (table === 'members') return membersOps()
      // No use cases here for inbound writers — return a noop.
      return noopOps()
    },
  }
}

function qualityOps() {
  // findLatest is not exercised by this integration test (handler only
  // inserts), but the production repo still expects `from('tenant_quality_state')`
  // to expose `select` so the contract lock object stays callable.
  // Chain shape: select().eq().order().order().limit().maybeSingle()
  const orderChain: Record<string, unknown> = {
    limit: () => ({
      maybeSingle: async () => ({
        data: state.qualityEvents.at(-1) ?? null,
        error: null,
      }),
    }),
  }
  orderChain.order = () => orderChain
  return {
    insert: async (row: QualityRow) => {
      state.qualityEvents.push(row)
      return { error: null }
    },
    select: () => ({
      eq: () => orderChain,
    }),
  }
}

function processedOps() {
  return {
    insert: async (row: { idempotency_key: string }) => {
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

function messagesOps() {
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
    update: (patch: Partial<MessageRow>) => ({
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
    update: () => {
      const node: Record<string, unknown> = {}
      node.eq = () => node
      node.or = () => node
      node.then = (
        onFulfilled: (v: { error: null }) => unknown,
        onRejected?: (e: unknown) => unknown
      ) => Promise.resolve({ error: null }).then(onFulfilled, onRejected)
      return node
    },
  }
}

function noopOps() {
  return {
    insert: async () => ({ error: null }),
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
    }),
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
  // Tests already run with NODE_ENV='test' which is fine for the
  // demo-mode signature short-circuit.
})

afterAll(() => {
  if (ORIGINAL_SECRET !== undefined) {
    process.env.KAPSO_WEBHOOK_SECRET = ORIGINAL_SECRET
  }
})

beforeEach(() => {
  reset()
  vi.clearAllMocks()
  vi.useRealTimers()
  vi.mocked(findByPhoneNumberId).mockResolvedValue({ id: 'rest-1' } as never)
  vi.mocked(findByDisplayPhoneNumber).mockResolvedValue({ id: 'rest-1' } as never)
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
  const res = await POST(req as never)
  return { status: res.status, json: await res.json() }
}

describe('POST /api/webhooks/whatsapp — quality events (WAQ-006)', () => {
  it('inserts a YELLOW transition row from a Meta account_update payload', async () => {
    const fixture = loadFixture('meta-account-quality-yellow.json')

    const { status, json } = await postWebhook(fixture)

    expect(status).toBe(200)
    expect(json).toEqual({ status: 'ok' })
    expect(state.qualityEvents).toHaveLength(1)
    expect(state.qualityEvents[0]).toMatchObject({
      restaurant_id: 'rest-1',
      phone_number_id: 'WAQ002_TEST_PHONE_NUMBER_ID',
      quality_rating: 'YELLOW',
      messaging_tier: 'TIER_1K',
      flagged: false,
    })
    expect(state.qualityEvents[0].raw_payload).toMatchObject({
      quality: 'yellow',
      current_limit: 'TIER_1K',
    })
  })

  it('inserts a GREEN row', async () => {
    const fixture = loadFixture('meta-account-quality-green.json')
    await postWebhook(fixture)
    expect(state.qualityEvents).toHaveLength(1)
    expect(state.qualityEvents[0].quality_rating).toBe('GREEN')
    expect(state.qualityEvents[0].messaging_tier).toBe('TIER_10K')
  })

  it('inserts a RED row', async () => {
    const fixture = loadFixture('meta-account-quality-red.json')
    await postWebhook(fixture)
    expect(state.qualityEvents).toHaveLength(1)
    expect(state.qualityEvents[0].quality_rating).toBe('RED')
  })

  it('repeat POST is idempotent — no duplicate row inserted (payload-derived key)', async () => {
    // Idempotency is now payload-derived, so the wall clock is irrelevant.
    // Two identical POSTs collapse to one row regardless of how far apart
    // they arrive. Cf. the unit test "same payload after 30 seconds".
    const fixture = loadFixture('meta-account-quality-yellow.json')

    await postWebhook(fixture)
    expect(state.qualityEvents).toHaveLength(1)

    const { status } = await postWebhook(fixture)
    expect(status).toBe(200)
    expect(state.qualityEvents).toHaveLength(1)
  })

  it('REGRESSION: status webhook flow still works (WAQ-002)', async () => {
    seedMessage({ id: 'msg-1', kapso_message_id: 'wamid.WAQ002_DELIVERED' })
    const fixture = loadFixture('kapso-status-delivered.json')

    const { status, json } = await postWebhook(fixture)

    expect(status).toBe(200)
    expect(json).toEqual({ status: 'ok' })
    expect(state.messages.get('msg-1')!.status).toBe('delivered')
    // Quality table untouched
    expect(state.qualityEvents).toHaveLength(0)
  })

  it('phone_number_quality_update with only display_phone_number: resolves restaurant + inserts row', async () => {
    // Resolver must fall back to display_phone_number when the event omits
    // phone_number_id. Pre-fix this dropped the webhook silently.
    // (Use mockResolvedValue, not Once, so we don't pollute the next test.)
    vi.mocked(findByPhoneNumberId).mockResolvedValue(null as never)
    vi.mocked(findByDisplayPhoneNumber).mockResolvedValue({
      id: 'rest-1',
    } as never)

    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA-1',
          changes: [
            {
              field: 'phone_number_quality_update',
              value: {
                display_phone_number: '85291234567',
                event: 'FLAGGED',
                current_limit: 'TIER_1K',
              },
            },
          ],
        },
      ],
    }

    const { status, json } = await postWebhook(body)

    expect(status).toBe(200)
    expect(json).toEqual({ status: 'ok' })
    expect(vi.mocked(findByDisplayPhoneNumber)).toHaveBeenCalledWith('85291234567')
    expect(state.qualityEvents).toHaveLength(1)
    expect(state.qualityEvents[0]).toMatchObject({
      restaurant_id: 'rest-1',
      phone_number_id: null,
      display_phone_number: '85291234567',
      flagged: true,
    })
  })

  it('account_update payload still resolves via phone_number_id (regression)', async () => {
    // Both finders are mocked, but the id finder takes precedence so
    // findByDisplayPhoneNumber must NOT be called for the id-bearing case.
    const fixture = loadFixture('meta-account-quality-yellow.json')
    await postWebhook(fixture)
    expect(vi.mocked(findByPhoneNumberId)).toHaveBeenCalledWith(
      'WAQ002_TEST_PHONE_NUMBER_ID'
    )
    expect(vi.mocked(findByDisplayPhoneNumber)).not.toHaveBeenCalled()
    expect(state.qualityEvents).toHaveLength(1)
    expect(state.qualityEvents[0].phone_number_id).toBe(
      'WAQ002_TEST_PHONE_NUMBER_ID'
    )
  })

  it('neither phone_number_id nor display_phone_number: returns 200 ignored', async () => {
    vi.mocked(findByPhoneNumberId).mockResolvedValue(null as never)
    vi.mocked(findByDisplayPhoneNumber).mockResolvedValue(null as never)

    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'message_template_quality_update',
              value: { new_quality_score: 'GREEN' },
            },
          ],
        },
      ],
    }

    const { status, json } = await postWebhook(body)
    expect(status).toBe(200)
    expect(json).toEqual({ status: 'ignored' })
    expect(state.qualityEvents).toHaveLength(0)
  })

  it('REGRESSION: classifier still returns inbound (not quality) for messages payload', async () => {
    // Direct classifier check — full inbound routing requires the member
    // repository which is not part of this slice's mock surface.
    const { classifyWebhookKind } = await import(
      '@/infrastructure/whatsapp/webhooks'
    )
    const inboundBody = {
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                messages: [{ id: 'wamid.X', from: '+85291234567', type: 'text' }],
              },
            },
          ],
        },
      ],
    }
    expect(classifyWebhookKind(inboundBody)).toBe('inbound')
    // Status payload still routes to status, not quality.
    const statusBody = {
      entry: [
        {
          changes: [
            {
              value: { statuses: [{ id: 'wamid.X', status: 'delivered' }] },
            },
          ],
        },
      ],
    }
    expect(classifyWebhookKind(statusBody)).toBe('status')
  })
})
