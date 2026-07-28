/**
 * TPL-009 integration: posts synthetic Meta / Kapso
 * message_template_status_update payloads to the route handler and asserts
 * the full seam — signature -> resolve (WABA rung) -> classify
 * ('template_status') -> handler -> whatsapp_templates row updated.
 *
 * Unlike the handler unit tests, the template repository is NOT mocked: the
 * real repo runs against a fake supabase client so the assertion is on the
 * persisted ROW (including the rejection_reason column mapping), not on a
 * mock call.
 *
 * Auth: KAPSO_WEBHOOK_SECRET unset so verifySignature returns true via the
 * demo-mode short-circuit (mirrors route.quality-event.integration.test.ts).
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

vi.mock('@/infrastructure/supabase/repositories/restaurant-repository', () => ({
  findByPhoneNumberId: vi.fn(),
  findByDisplayPhoneNumber: vi.fn(),
  findByBusinessAccountId: vi.fn(),
  getRestaurantPhoneNumberId: vi.fn(),
}))

import {
  findByBusinessAccountId,
  findByDisplayPhoneNumber,
  findByPhoneNumberId,
} from '@/infrastructure/supabase/repositories/restaurant-repository'

const WABA_ID = '1671944700578218'
const META_TEMPLATE_ID = '1029650636326514'

interface TemplateRow extends Record<string, unknown> {
  id: string
  restaurant_id: string
  meta_template_id: string | null
  name: string
  language: string
  category: string
  status: string
  components: unknown
  parameter_format: string
  rejection_reason: string | null
  created_at: string
  updated_at: string
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
  kapso_message_id: string | null
  status: string
  queued_at: string
  sent_at: string | null
  delivered_at: string | null
  read_at: string | null
  failed_at: string | null
  raw_status_payload: Record<string, unknown> | null
}

const state = {
  templates: new Map<string, TemplateRow>(),
  templateUpdates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
  messages: new Map<string, MessageRow>(),
  processed: new Set<string>(),
  // Forces tryMarkProcessed into the 'error' branch (non-23505 insert error).
  processedInsertError: null as { code: string; message: string } | null,
}

function reset(): void {
  state.templates.clear()
  state.templateUpdates.length = 0
  state.messages.clear()
  state.processed.clear()
  state.processedInsertError = null
}

function seedTemplate(overrides: Partial<TemplateRow> = {}): TemplateRow {
  const row: TemplateRow = {
    id: 'tpl-1',
    restaurant_id: 'rest-1',
    meta_template_id: META_TEMPLATE_ID,
    name: 'offer_promotion',
    language: 'zh_HK',
    category: 'MARKETING',
    status: 'pending',
    components: [],
    parameter_format: 'NAMED',
    rejection_reason: null,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
  state.templates.set(row.id, row)
  return row
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
    status: 'sent',
    queued_at: '2026-07-01T09:59:00.000Z',
    sent_at: '2026-07-01T09:59:30.000Z',
    delivered_at: null,
    read_at: null,
    failed_at: null,
    raw_status_payload: null,
    ...row,
  } as MessageRow)
}

function fakeSupabase() {
  return {
    from(table: string) {
      if (table === 'whatsapp_templates') return templatesOps()
      if (table === 'processed_webhooks') return processedOps()
      if (table === 'whatsapp_messages') return messagesOps()
      if (table === 'members') return membersOps()
      return noopOps()
    },
  }
}

/**
 * Mimics the postgrest chain the template repo builds:
 *   select('*').eq(..).eq(..).neq('status','deleted').single()
 *   update(patch).eq('id', id).select('*').single()
 */
function templatesOps() {
  const eqs: Array<[string, unknown]> = []
  const neqs: Array<[string, unknown]> = []
  const match = (): TemplateRow | null => {
    for (const row of state.templates.values()) {
      if (eqs.every(([c, v]) => row[c] === v) && neqs.every(([c, v]) => row[c] !== v)) {
        return row
      }
    }
    return null
  }
  const selectNode: Record<string, unknown> = {
    single: async () => ({ data: match(), error: null }),
    maybeSingle: async () => ({ data: match(), error: null }),
  }
  selectNode.eq = (col: string, val: unknown) => {
    eqs.push([col, val])
    return selectNode
  }
  selectNode.neq = (col: string, val: unknown) => {
    neqs.push([col, val])
    return selectNode
  }
  return {
    select: () => selectNode,
    update: (patch: Record<string, unknown>) => ({
      eq: (col: string, val: unknown) => ({
        select: () => ({
          single: async () => {
            const row = [...state.templates.values()].find((r) => r[col] === val)
            if (!row) return { data: null, error: { message: 'not found' } }
            state.templateUpdates.push({ id: row.id, patch })
            Object.assign(row, patch)
            return { data: row, error: null }
          },
        }),
      }),
    }),
  }
}

function processedOps() {
  return {
    insert: async (row: { idempotency_key: string }) => {
      if (state.processedInsertError) return { error: state.processedInsertError }
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
          if ((row as Record<string, unknown>)[col] === value) Object.assign(row, patch)
        }
        return { error: null }
      },
    }),
  }
}

function membersOps() {
  return {
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
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
})

afterAll(() => {
  if (ORIGINAL_SECRET !== undefined) {
    process.env.KAPSO_WEBHOOK_SECRET = ORIGINAL_SECRET
  }
})

beforeEach(() => {
  reset()
  vi.clearAllMocks()
  // Template-status payloads carry no phone identifiers, so the first two
  // resolver rungs must never even be consulted; they return null here so a
  // regression that DID consult them would surface as an ignored webhook.
  vi.mocked(findByPhoneNumberId).mockResolvedValue(null as never)
  vi.mocked(findByDisplayPhoneNumber).mockResolvedValue(null as never)
  vi.mocked(findByBusinessAccountId).mockResolvedValue({ id: 'rest-1' } as never)
})

function loadFixture(name: string): Record<string, unknown> {
  const file = path.join(__dirname, '../../../../../../docs/playbooks/fixtures', name)
  return JSON.parse(readFileSync(file, 'utf-8'))
}

async function postWebhook(body: unknown): Promise<{
  status: number
  json: Record<string, unknown>
}> {
  return postRaw(JSON.stringify(body))
}

async function postRaw(rawBody: string): Promise<{
  status: number
  json: Record<string, unknown>
}> {
  const { POST } = await import('../route')
  const req = new Request('http://localhost/api/webhooks/whatsapp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: rawBody,
  })
  const res = await POST(req as never)
  return { status: res.status, json: await res.json() }
}

function kapsoFlatBody(overrides: Record<string, unknown> = {}) {
  return {
    event: 'message_template_status_update',
    data: {
      waba_id: WABA_ID,
      event: 'APPROVED',
      message_template_id: META_TEMPLATE_ID,
      message_template_name: 'offer_promotion',
      message_template_language: 'zh_HK',
      reason: 'NONE',
      ...overrides,
    },
  }
}

describe('POST /api/webhooks/whatsapp — template status events (TPL-009)', () => {
  it('APPROVED for a known WABA flips the local row pending -> approved', async () => {
    seedTemplate({ status: 'pending' })

    const { status, json } = await postWebhook(
      loadFixture('meta-template-status-approved.json')
    )

    expect(status).toBe(200)
    expect(json).toEqual({ status: 'ok' })
    // Resolved via the WABA rung only — phone rungs never consulted.
    expect(vi.mocked(findByBusinessAccountId)).toHaveBeenCalledWith(WABA_ID)
    expect(vi.mocked(findByPhoneNumberId)).not.toHaveBeenCalled()
    expect(vi.mocked(findByDisplayPhoneNumber)).not.toHaveBeenCalled()
    // The ROW changed, not just a mock.
    expect(state.templates.get('tpl-1')!.status).toBe('approved')
    expect(state.templateUpdates).toEqual([
      { id: 'tpl-1', patch: { status: 'approved' } },
    ])
  })

  it('duplicate replay of the same payload applies the update exactly once', async () => {
    seedTemplate({ status: 'pending' })
    const fixture = loadFixture('meta-template-status-approved.json')

    const first = await postWebhook(fixture)
    expect(first.status).toBe(200)
    expect(state.templateUpdates).toHaveLength(1)

    const second = await postWebhook(fixture)

    expect(second.status).toBe(200)
    expect(second.json).toEqual({ status: 'ok' })
    expect(state.templateUpdates).toHaveLength(1)
    expect(state.templates.get('tpl-1')!.status).toBe('approved')
  })

  it('unknown WABA returns 200 ignored and writes nothing', async () => {
    seedTemplate({ status: 'pending' })
    vi.mocked(findByBusinessAccountId).mockResolvedValue(null as never)

    const { status, json } = await postWebhook(
      loadFixture('meta-template-status-approved.json')
    )

    expect(status).toBe(200)
    expect(json).toEqual({ status: 'ignored' })
    expect(state.templateUpdates).toHaveLength(0)
    expect(state.processed.size).toBe(0)
    expect(state.templates.get('tpl-1')!.status).toBe('pending')
  })

  it('malformed JSON returns 400 (never retried by the provider)', async () => {
    const { status, json } = await postRaw('{ not json ')

    expect(status).toBe(400)
    expect(json).toEqual({ error: 'Malformed JSON' })
    expect(state.templateUpdates).toHaveLength(0)
  })

  it('idempotency claim error returns 500 so Kapso retries', async () => {
    seedTemplate({ status: 'pending' })
    state.processedInsertError = { code: '08006', message: 'connection failure' }

    const { status, json } = await postWebhook(
      loadFixture('meta-template-status-approved.json')
    )

    expect(status).toBe(500)
    expect(json).toEqual({ error: 'Internal error' })
    expect(state.templateUpdates).toHaveLength(0)
    expect(state.templates.get('tpl-1')!.status).toBe('pending')
  })

  it('Kapso-flat variant produces the same outcome as the Meta envelope', async () => {
    seedTemplate({ status: 'pending' })

    const { status, json } = await postWebhook(kapsoFlatBody())

    expect(status).toBe(200)
    expect(json).toEqual({ status: 'ok' })
    expect(vi.mocked(findByBusinessAccountId)).toHaveBeenCalledWith(WABA_ID)
    expect(state.templates.get('tpl-1')!.status).toBe('approved')
    expect(state.templateUpdates).toEqual([
      { id: 'tpl-1', patch: { status: 'approved' } },
    ])
  })

  // The webhook deliberately does NOT persist terminal statuses. `rejected`
  // is outside SYNCABLE_STATUSES, so writing it here would put the row beyond
  // the 15-min cron's reach permanently — and a stale REJECTED arriving after
  // a real APPROVED would then brick the template with Meta saying APPROVED.
  // The cron reads live Meta state and owns the rejection_reason write.
  it('REJECTED leaves the row cron-reachable instead of writing a terminal status', async () => {
    seedTemplate({ status: 'pending' })

    const { status } = await postWebhook(
      kapsoFlatBody({ event: 'REJECTED', reason: 'Sample media mismatch' })
    )

    expect(status).toBe(200)
    const row = state.templates.get('tpl-1')!
    expect(row.status).toBe('pending')
    expect(state.templateUpdates).toEqual([])
  })

  it('a draft row is never mutated by the webhook', async () => {
    // Seeded WITH the fixture's meta id so the row is genuinely resolved and
    // the FROM-guard (draft ∉ SYNCABLE_STATUSES) is what stops the write.
    // With meta_template_id null the lookup would simply miss and the test
    // would pass without ever reaching the guard it claims to cover.
    seedTemplate({ status: 'draft' })

    const { status, json } = await postWebhook(
      loadFixture('meta-template-status-approved.json')
    )

    expect(status).toBe(200)
    expect(json).toEqual({ status: 'ok' })
    expect(state.templateUpdates).toHaveLength(0)
    expect(state.templates.get('tpl-1')!.status).toBe('draft')
  })

  it('unknown template returns 200 ok and writes nothing', async () => {
    const { status, json } = await postWebhook(
      loadFixture('meta-template-status-approved.json')
    )

    expect(status).toBe(200)
    expect(json).toEqual({ status: 'ok' })
    expect(state.templateUpdates).toHaveLength(0)
  })

  // classifyWebhookKind returns ONE kind by precedence, so a batch carrying
  // both statuses and a template-status change classifies as 'status'. The
  // template transition must still be applied, not silently dropped until
  // the cron notices 15 minutes later.
  it('applies the template transition in a batch that also carries statuses', async () => {
    vi.mocked(findByPhoneNumberId).mockResolvedValue({ id: 'rest-1' } as never)
    seedTemplate({ status: 'pending' })

    const templateFixture = loadFixture('meta-template-status-approved.json')
    const statusEntry = {
      id: WABA_ID,
      changes: [
        {
          field: 'statuses',
          value: {
            metadata: { phone_number_id: 'PN-1' },
            statuses: [
              { id: 'wamid.MIXED', status: 'delivered', timestamp: '1785283200' },
            ],
          },
        },
      ],
    }
    const mixed = {
      ...templateFixture,
      entry: [statusEntry, ...(templateFixture.entry as unknown[])],
    }

    const { classifyWebhookKind } = await import(
      '@/infrastructure/whatsapp/webhooks'
    )
    expect(classifyWebhookKind(mixed)).toBe('status')

    const { status } = await postWebhook(mixed)

    expect(status).toBe(200)
    expect(state.templates.get('tpl-1')!.status).toBe('approved')
  })

  describe('anti-regression through the new third resolver rung', () => {
    it('status webhook still routes as status and updates the message row', async () => {
      vi.mocked(findByPhoneNumberId).mockResolvedValue({ id: 'rest-1' } as never)
      seedMessage({ id: 'msg-1', kapso_message_id: 'wamid.WAQ002_DELIVERED' })
      seedTemplate({ status: 'pending' })

      const fixture = loadFixture('kapso-status-delivered.json')
      const { classifyWebhookKind, extractTemplateStatusWabaId } = await import(
        '@/infrastructure/whatsapp/webhooks'
      )
      expect(classifyWebhookKind(fixture)).toBe('status')
      expect(extractTemplateStatusWabaId(fixture)).toBeNull()

      const { status, json } = await postWebhook(fixture)

      expect(status).toBe(200)
      expect(json).toEqual({ status: 'ok' })
      expect(state.messages.get('msg-1')!.status).toBe('delivered')
      // WABA rung not reached; template table untouched.
      expect(vi.mocked(findByBusinessAccountId)).not.toHaveBeenCalled()
      expect(state.templateUpdates).toHaveLength(0)
    })

    it('inbound message payload still classifies as inbound and never hits the WABA rung', async () => {
      // Direct classifier check — full inbound routing requires the member
      // repository which is not part of this slice's mock surface (mirrors
      // route.quality-event.integration.test.ts).
      const { classifyWebhookKind, extractTemplateStatusWabaId } = await import(
        '@/infrastructure/whatsapp/webhooks'
      )
      const inboundBody = {
        entry: [
          {
            id: WABA_ID,
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { phone_number_id: 'pn-1' },
                  messages: [{ id: 'wamid.X', from: '+85291234567', type: 'text' }],
                },
              },
            ],
          },
        ],
      }

      expect(classifyWebhookKind(inboundBody)).toBe('inbound')
      expect(extractTemplateStatusWabaId(inboundBody)).toBeNull()
    })
  })
})
