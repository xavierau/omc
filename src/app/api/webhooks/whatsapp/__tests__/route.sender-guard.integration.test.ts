/**
 * Issue #45 defense in depth: the route-level sender guard must hold even if
 * the parser regresses. parseKapsoWebhook is stubbed here to return messages
 * the real parser would reject, proving the guard alone 200-ignores them
 * without claiming idempotency (a burned claim = permanent message drop).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { parseKapsoWebhook } = vi.hoisted(() => ({ parseKapsoWebhook: vi.fn() }))

vi.mock('@/infrastructure/whatsapp/webhooks', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/infrastructure/whatsapp/webhooks')>()
  return { ...actual, parseKapsoWebhook }
})
vi.mock('../resolve-tenant', () => ({
  resolveRestaurant: vi.fn(async () => 'rest-1'),
}))
vi.mock('../handlers', () => ({
  routeMessage: vi.fn(async () => undefined),
}))
vi.mock('../status-handlers', () => ({
  routeStatusEvent: vi.fn(async () => undefined),
}))
vi.mock('../quality-handlers', () => ({
  routeQualityEvent: vi.fn(async () => undefined),
}))
vi.mock('@/infrastructure/supabase/idempotency', () => ({
  tryMarkProcessed: vi.fn(async () => 'new'),
}))

import { POST } from '../route'
import { routeMessage } from '../handlers'
import { tryMarkProcessed } from '@/infrastructure/supabase/idempotency'

function post() {
  return POST(
    new NextRequest('http://localhost/api/webhooks/whatsapp', {
      method: 'POST',
      body: JSON.stringify({
        message: { id: 'wamid.stub', type: 'text', timestamp: '1774685162' },
      }),
    })
  )
}

function stubMessage(from: string) {
  parseKapsoWebhook.mockReturnValue({
    messageId: 'wamid.stub',
    from,
    type: 'text' as const,
    text: 'x',
    timestamp: '1774685162',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('route sender guard (parser stubbed)', () => {
  it.each([
    ['empty', ''],
    ['whitespace-only', '   '],
    ['non-phone', 'abc'],
    ['too short', '12345'],
  ])('200-ignores a parsed message with %s from', async (_label, from) => {
    stubMessage(from)

    const res = await post()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ignored' })
    expect(tryMarkProcessed).not.toHaveBeenCalled()
    expect(routeMessage).not.toHaveBeenCalled()
  })

  it('routes a valid sender through to processing', async () => {
    stubMessage('85266281556')

    const res = await post()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
    expect(tryMarkProcessed).toHaveBeenCalledTimes(1)
    expect(routeMessage).toHaveBeenCalledTimes(1)
  })
})
