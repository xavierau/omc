/**
 * MEM-004 webhook-level test: an inbound message from a contact triggers
 * restoreMemberReachability for the resolved tenant + sender phone; status
 * webhooks (delivered / failed) never do. The use case itself is covered in
 * src/application/__tests__/restore-member-reachability.test.ts.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import kapsoV2Failed from '@/infrastructure/whatsapp/__tests__/fixtures/kapso-v2-failed-131042.json'
import kapsoV2Delivered from '@/infrastructure/whatsapp/__tests__/fixtures/kapso-v2-delivered.json'

vi.mock('@/infrastructure/supabase/repositories/restaurant-repository', () => ({
  findByPhoneNumberId: vi.fn(),
  findByDisplayPhoneNumber: vi.fn(),
  getRestaurantPhoneNumberId: vi.fn(),
  getRestaurantName: vi.fn(),
  getReplyConfig: vi.fn(async () => ({
    features: { points: true, rewards: true, redeem: true, card: true, help: true },
    text: {
      unknown: { en: null, zh: null },
      help: { en: null, zh: null },
      join: { en: null, zh: null },
    },
  })),
  getRestaurantRedirect: vi.fn(async () => ({ redirectNumber: null, redirectLabel: 'Contact us' })),
}))
vi.mock('@/infrastructure/supabase/repositories/restaurant-onboarding-repository', () => ({
  getRestaurantDefaultLanguage: vi.fn(),
}))
vi.mock('@/infrastructure/whatsapp/messaging', () => ({
  sendTextMessage: vi.fn(async () => ({ success: true })),
  sendInteractiveButtons: vi.fn(async () => ({ success: true })),
  sendImageMessage: vi.fn(async () => ({ success: true })),
}))
vi.mock('@/application/restore-member-reachability', () => ({
  restoreMemberReachability: vi.fn(async () => true),
}))
vi.mock('@/infrastructure/supabase/idempotency', () => ({
  tryMarkProcessed: vi.fn(async () => 'claimed'),
  releaseIdempotencyKey: vi.fn(async () => undefined),
}))

// Everything else the handler chain touches reads/writes a benign noop.
vi.mock('@/infrastructure/supabase/client', () => {
  const node: Record<string, unknown> = {}
  for (const k of ['eq', 'or', 'gt', 'lt', 'in', 'not', 'order', 'limit', 'select', 'update', 'is']) {
    node[k] = () => node
  }
  node.maybeSingle = async () => ({ data: null, error: null })
  node.single = async () => ({ data: null, error: null })
  node.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null }).then(res, rej)
  const table = { ...node, insert: async () => ({ error: null }), delete: () => node, upsert: async () => ({ error: null }) }
  return { createServerSupabaseClient: vi.fn(() => ({ from: () => table, rpc: async () => ({ data: null, error: null }) })) }
})

import { findByPhoneNumberId, getRestaurantPhoneNumberId, getRestaurantName } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { getRestaurantDefaultLanguage } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { restoreMemberReachability } from '@/application/restore-member-reachability'

const ORIGINAL_SECRET = process.env.KAPSO_WEBHOOK_SECRET
let POST: typeof import('../route').POST

beforeAll(async () => {
  delete process.env.KAPSO_WEBHOOK_SECRET
  ;({ POST } = await import('../route'))
}, 60_000)

afterAll(() => {
  if (ORIGINAL_SECRET !== undefined) process.env.KAPSO_WEBHOOK_SECRET = ORIGINAL_SECRET
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(findByPhoneNumberId).mockResolvedValue({ id: 'rest-1' } as never)
  vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('pn-1')
  vi.mocked(getRestaurantName).mockResolvedValue('Demo Cafe')
  vi.mocked(getRestaurantDefaultLanguage).mockResolvedValue('en')
})

function inboundBody(opts: { from?: string; type?: string; text?: string } = {}) {
  const from = opts.from ?? '85291234567'
  const message =
    opts.type === 'image'
      ? { id: 'wamid.IMG', from, type: 'image', image: { id: 'media-1' }, timestamp: '1790000000' }
      : { id: 'wamid.TXT', from, type: 'text', text: { body: opts.text ?? 'hello' }, timestamp: '1790000000' }
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA-1',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: 'pn-1', display_phone_number: '85291234567' },
          messages: [message],
          contacts: [{ profile: { name: 'Tester' }, wa_id: from }],
        },
      }],
    }],
  }
}

async function post(body: unknown): Promise<number> {
  const req = new Request('http://localhost/api/webhooks/whatsapp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return (await POST(req as never)).status
}

describe('POST /api/webhooks/whatsapp — reachability restore (MEM-004)', () => {
  it('an inbound text triggers restore for the tenant and normalised sender phone', async () => {
    expect(await post(inboundBody())).toBe(200)

    expect(restoreMemberReachability).toHaveBeenCalledTimes(1)
    expect(restoreMemberReachability).toHaveBeenCalledWith(
      { restaurantId: 'rest-1', phoneE164: '+85291234567', messageType: 'text' },
      expect.any(Function)
    )
  })

  it('an inbound non-text message (image) also triggers restore', async () => {
    expect(await post(inboundBody({ type: 'image' }))).toBe(200)

    expect(restoreMemberReachability).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantId: 'rest-1', messageType: 'image' }),
      expect.any(Function)
    )
  })

  it('a delivered status webhook does not trigger restore', async () => {
    expect(await post(kapsoV2Delivered)).toBe(200)
    expect(restoreMemberReachability).not.toHaveBeenCalled()
  })

  it('a failed status webhook does not trigger restore', async () => {
    expect(await post(kapsoV2Failed)).toBe(200)
    expect(restoreMemberReachability).not.toHaveBeenCalled()
  })
})
