/**
 * WAQ-008 integration: posts synthetic Meta inbound message webhooks
 * and asserts the conversation_windows row is upserted.
 *
 *   - First inbound: a NEW row is inserted with opened_at == now.
 *   - Same-phone inbound 2 minutes later: the SAME row is bumped
 *     (last_inbound_at + expires_at advance; opened_at preserved).
 *   - 25 hours later (mocked): a NEW row is inserted (the prior window
 *     has expired so the lookup misses).
 *   - bulkIsWindowOpen returns the right Set after the rows above exist.
 *
 * Auth: KAPSO_WEBHOOK_SECRET unset so verifySignature returns true via
 * the demo-mode short-circuit (mirrors the other integration tests).
 *
 * The handler downstream of routeMessage performs many reads we do not
 * care about for THIS test (member lookup, language detection, etc.).
 * Those calls hit a noop ops surface.
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
  getRestaurantName: vi.fn(),
  // REPLY-003: dispatch reads the reply config. Default = all functions ON,
  // no custom copy, preserving the existing fallback behavior here.
  getReplyConfig: vi.fn(async () => ({
    features: { points: true, rewards: true, redeem: true, card: true },
    text: {
      unknown: { en: null, zh: null },
      help: { en: null, zh: null },
      join: { en: null, zh: null },
    },
  })),
  getRestaurantRedirect: vi.fn(async () => ({
    redirectNumber: null,
    redirectLabel: 'Contact us',
  })),
}))
vi.mock('@/infrastructure/supabase/repositories/restaurant-onboarding-repository', () => ({
  getRestaurantDefaultLanguage: vi.fn(),
}))
vi.mock('@/infrastructure/whatsapp/messaging', () => ({
  sendTextMessage: vi.fn(async () => ({ success: true })),
  sendInteractiveButtons: vi.fn(async () => ({ success: true })),
  sendImageMessage: vi.fn(async () => ({ success: true })),
}))

import {
  findByPhoneNumberId,
  getRestaurantPhoneNumberId,
  getRestaurantName,
} from '@/infrastructure/supabase/repositories/restaurant-repository'
import { getRestaurantDefaultLanguage } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import {
  bulkIsWindowOpen,
} from '@/infrastructure/supabase/repositories/conversation-window-repository'

interface WindowRow extends Record<string, unknown> {
  id: string
  restaurant_id: string
  phone_e164: string
  opened_at: string
  last_inbound_at: string
  expires_at: string
}

const state = {
  windows: new Map<string, WindowRow>(),
  processed: new Set<string>(),
}

function reset(): void {
  state.windows.clear()
  state.processed.clear()
}

function fakeSupabase() {
  return {
    from(table: string) {
      if (table === 'conversation_windows') return windowsOps()
      if (table === 'processed_webhooks') return processedOps()
      // Everything else (members, whatsapp_messages, etc.) is a noop —
      // the handler may read but writes here aren't relevant to WAQ-008.
      return noopOps()
    },
  }
}

function windowsOps() {
  return {
    insert: async (row: WindowRow) => {
      state.windows.set(row.id, row)
      return { error: null }
    },
    select: (cols: string) => buildWindowsSelect(cols),
    update: (patch: Partial<WindowRow>) => buildWindowsUpdate(patch),
  }
}

function buildWindowsSelect(cols: string) {
  // The chain supports: .eq().eq().gt().order().limit().maybeSingle()  (find)
  //                    .eq().gt().in()                                  (bulk)
  // Track filters so the matcher can narrow the row set.
  const filters: Array<(row: WindowRow) => boolean> = []
  let inFilter: ((row: WindowRow) => boolean) | null = null
  let limitN: number | null = null
  let orderDesc: { col: keyof WindowRow } | null = null
  const node: Record<string, unknown> = {}
  node.eq = (col: string, val: unknown) => {
    filters.push((r) => (r as Record<string, unknown>)[col] === val)
    return node
  }
  node.gt = (col: string, val: unknown) => {
    filters.push(
      (r) => ((r as Record<string, unknown>)[col] as string) > (val as string)
    )
    return node
  }
  node.in = (col: string, vals: unknown[]) => {
    inFilter = (r) =>
      (vals as unknown[]).includes((r as Record<string, unknown>)[col])
    return runQuery(cols, filters, inFilter, orderDesc, limitN, false)
  }
  node.order = (col: string, opts: { ascending: boolean }) => {
    if (!opts.ascending) orderDesc = { col: col as keyof WindowRow }
    return node
  }
  node.limit = (n: number) => {
    limitN = n
    return {
      maybeSingle: () =>
        runQuery(cols, filters, inFilter, orderDesc, limitN, true),
    }
  }
  return node
}

async function runQuery(
  cols: string,
  filters: Array<(row: WindowRow) => boolean>,
  inFilter: ((row: WindowRow) => boolean) | null,
  orderDesc: { col: keyof WindowRow } | null,
  limitN: number | null,
  single: boolean
) {
  let rows = Array.from(state.windows.values())
  for (const f of filters) rows = rows.filter(f)
  if (inFilter) rows = rows.filter(inFilter)
  if (orderDesc) {
    rows = rows.slice().sort((a, b) => {
      const va = String(a[orderDesc.col])
      const vb = String(b[orderDesc.col])
      return va < vb ? 1 : va > vb ? -1 : 0
    })
  }
  if (limitN !== null) rows = rows.slice(0, limitN)
  // For SELECT 'phone_e164' (bulk variant) project the column.
  const data = cols === 'phone_e164'
    ? rows.map((r) => ({ phone_e164: r.phone_e164 }))
    : rows
  if (single) return { data: data[0] ?? null, error: null }
  return { data, error: null }
}

function buildWindowsUpdate(patch: Partial<WindowRow>) {
  const node: Record<string, unknown> = {}
  let id: string | null = null
  node.eq = (col: string, val: string) => {
    if (col === 'id') id = val
    return node
  }
  node.then = (
    onFulfilled: (v: { error: null }) => unknown,
    onRejected?: (e: unknown) => unknown
  ) => {
    if (id) {
      const existing = state.windows.get(id)
      if (existing) Object.assign(existing, patch)
    }
    return Promise.resolve({ error: null }).then(onFulfilled, onRejected)
  }
  return node
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
      eq: async () => ({ error: null }),
    }),
  }
}

function noopOps() {
  // Catches reads/writes from other repos the handler chain may touch. Each
  // shape returns benign defaults so the inbound flow can complete.
  const node: Record<string, unknown> = {}
  node.eq = () => node
  node.or = () => node
  node.in = () => Promise.resolve({ data: [], error: null })
  node.gt = () => node
  node.order = () => node
  node.limit = () => ({ maybeSingle: async () => ({ data: null, error: null }) })
  node.maybeSingle = async () => ({ data: null, error: null })
  node.single = async () => ({ data: null, error: null })
  node.then = (
    onFulfilled: (v: { error: null; data: null }) => unknown,
    onRejected?: (e: unknown) => unknown
  ) =>
    Promise.resolve({ error: null, data: null }).then(onFulfilled, onRejected)
  return {
    insert: async () => ({ error: null }),
    select: () => node,
    update: () => node,
    delete: () => ({ eq: async () => ({ error: null }) }),
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
  vi.useRealTimers()
  vi.mocked(findByPhoneNumberId).mockResolvedValue({ id: 'rest-1' } as never)
  vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('pn-1')
  vi.mocked(getRestaurantName).mockResolvedValue('Demo Cafe')
  vi.mocked(getRestaurantDefaultLanguage).mockResolvedValue('en')
})

interface InboundOpts {
  text?: string
  messageId?: string
  from?: string
  timestampSec?: number
}

function buildInboundBody(opts: InboundOpts = {}): unknown {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA-1',
        changes: [
          {
            field: 'messages',
            value: {
              metadata: {
                phone_number_id: 'pn-1',
                display_phone_number: '85291234567',
              },
              messages: [
                {
                  id: opts.messageId ?? 'wamid.WAQ008_TEST_1',
                  from: opts.from ?? '85291234567',
                  type: 'text',
                  text: { body: opts.text ?? 'POINTS' },
                  timestamp: String(
                    opts.timestampSec ??
                      Math.floor(Date.now() / 1000)
                  ),
                },
              ],
              contacts: [
                { profile: { name: 'Tester' }, wa_id: opts.from ?? '85291234567' },
              ],
            },
          },
        ],
      },
    ],
  }
}

async function postWebhook(body: unknown): Promise<{ status: number }> {
  const { POST } = await import('../route')
  const req = new Request('http://localhost/api/webhooks/whatsapp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const res = await POST(req as never)
  return { status: res.status }
}

describe('POST /api/webhooks/whatsapp — conversation window tracking (WAQ-008)', () => {
  it('inserts a fresh window row on the first inbound for (rid, phone)', async () => {
    vi.setSystemTime(new Date('2026-05-04T10:00:00.000Z'))

    const { status } = await postWebhook(
      buildInboundBody({ messageId: 'wamid.A1', text: 'POINTS' })
    )

    expect(status).toBe(200)
    expect(state.windows.size).toBe(1)
    const [row] = state.windows.values()
    expect(row.restaurant_id).toBe('rest-1')
    expect(row.phone_e164).toBe('+85291234567')
    expect(row.opened_at).toBe('2026-05-04T10:00:00.000Z')
    expect(row.last_inbound_at).toBe('2026-05-04T10:00:00.000Z')
    expect(row.expires_at).toBe('2026-05-05T10:00:00.000Z')
  })

  it('bumps the SAME row on a second inbound 2 minutes later (opened_at preserved)', async () => {
    vi.setSystemTime(new Date('2026-05-04T10:00:00.000Z'))
    await postWebhook(buildInboundBody({ messageId: 'wamid.B1' }))
    expect(state.windows.size).toBe(1)
    const [first] = state.windows.values()
    const firstId = first.id

    vi.setSystemTime(new Date('2026-05-04T10:02:00.000Z'))
    await postWebhook(buildInboundBody({ messageId: 'wamid.B2' }))

    expect(state.windows.size).toBe(1)
    const row = state.windows.get(firstId)!
    expect(row.opened_at).toBe('2026-05-04T10:00:00.000Z')
    expect(row.last_inbound_at).toBe('2026-05-04T10:02:00.000Z')
    expect(row.expires_at).toBe('2026-05-05T10:02:00.000Z')
  })

  it('inserts a NEW row when the prior window has expired (>24h later)', async () => {
    vi.setSystemTime(new Date('2026-05-04T10:00:00.000Z'))
    await postWebhook(buildInboundBody({ messageId: 'wamid.C1' }))
    expect(state.windows.size).toBe(1)

    // 25 hours later — prior window's expires_at = +24h, so it has lapsed.
    vi.setSystemTime(new Date('2026-05-05T11:00:00.000Z'))
    await postWebhook(buildInboundBody({ messageId: 'wamid.C2' }))

    expect(state.windows.size).toBe(2)
    const rows = Array.from(state.windows.values()).sort(
      (a, b) => Date.parse(a.opened_at) - Date.parse(b.opened_at)
    )
    expect(rows[0].opened_at).toBe('2026-05-04T10:00:00.000Z')
    expect(rows[0].expires_at).toBe('2026-05-05T10:00:00.000Z')
    expect(rows[1].opened_at).toBe('2026-05-05T11:00:00.000Z')
    expect(rows[1].expires_at).toBe('2026-05-06T11:00:00.000Z')
  })

  it('bulkIsWindowOpen returns only phones with currently-open windows', async () => {
    vi.setSystemTime(new Date('2026-05-04T10:00:00.000Z'))
    await postWebhook(
      buildInboundBody({ from: '85291111111', messageId: 'wamid.D1' })
    )
    await postWebhook(
      buildInboundBody({ from: '85292222222', messageId: 'wamid.D2' })
    )
    expect(state.windows.size).toBe(2)

    // Query at a time when both are still open.
    vi.setSystemTime(new Date('2026-05-04T15:00:00.000Z'))
    const open = await bulkIsWindowOpen({
      restaurantId: 'rest-1',
      phones: ['+85291111111', '+85292222222', '+85293333333'],
    })

    expect(open).toEqual(new Set(['+85291111111', '+85292222222']))
  })
})
