/**
 * Issue #45 regression: message-shaped webhooks with no sender (`from`)
 * — Kapso status/echo events — must be 200-ignored, never 500. A 500
 * invites the provider retry storm, and because the idempotency key was
 * claimed before processing, the event was then dropped forever.
 *
 * Asserts the two invariants the fix restores:
 *   - HTTP 200 { status: 'ignored' } for both Kapso-flat and Meta shapes
 *   - no idempotency claim and no routeMessage call for such events
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

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
  tryMarkProcessed: vi.fn(async () => 'claimed'),
}))

import { POST } from '../route'
import { routeMessage } from '../handlers'
import { tryMarkProcessed } from '@/infrastructure/supabase/idempotency'

function post(body: unknown) {
  return POST(
    new NextRequest('http://localhost/api/webhooks/whatsapp', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/webhooks/whatsapp — no-sender events (issue #45)', () => {
  it('200-ignores a Kapso message without from; no idempotency claim, no routing', async () => {
    const res = await post({
      message: {
        id: 'wamid.nofrom',
        type: 'text',
        text: { body: 'x' },
        timestamp: '1774685162',
      },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ignored' })
    expect(tryMarkProcessed).not.toHaveBeenCalled()
    expect(routeMessage).not.toHaveBeenCalled()
  })

  it('200-ignores a Meta message without from; no idempotency claim, no routing', async () => {
    const res = await post({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid.meta-nofrom',
                    type: 'interactive',
                    interactive: { button_reply: { id: 'btn-1' } },
                    timestamp: '1774685162',
                  },
                ],
              },
            },
          ],
        },
      ],
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ignored' })
    expect(tryMarkProcessed).not.toHaveBeenCalled()
    expect(routeMessage).not.toHaveBeenCalled()
  })

  it('still processes a normal inbound message with a sender', async () => {
    const res = await post({
      message: {
        from: '85266281556',
        id: 'wamid.normal',
        type: 'text',
        text: { body: 'JOIN' },
        timestamp: '1774685162',
      },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
    expect(tryMarkProcessed).toHaveBeenCalledWith('wamid.normal', expect.anything())
    expect(routeMessage).toHaveBeenCalledTimes(1)
  })
})
