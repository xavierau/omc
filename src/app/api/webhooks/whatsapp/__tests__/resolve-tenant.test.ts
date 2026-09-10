import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/restaurant-repository', () => ({
  findByPhoneNumberId: vi.fn(),
  findByDisplayPhoneNumber: vi.fn(),
  findByBusinessAccountId: vi.fn(),
}))

import { resolveRestaurant } from '../resolve-tenant'
import {
  findByPhoneNumberId,
  findByDisplayPhoneNumber,
  findByBusinessAccountId,
} from '@/infrastructure/supabase/repositories/restaurant-repository'
import type { LogFn } from '@/domain/ports/whatsapp-webhooks'

const KNOWN_WABA = '1671944700578218'

function templateStatusPayload(wabaId: string) {
  return {
    entry: [
      {
        id: wabaId,
        time: 1732600000,
        changes: [
          {
            field: 'message_template_status_update',
            value: {
              event: 'APPROVED',
              message_template_id: 1029650636326514,
              message_template_name: 'offer_promotion',
              message_template_language: 'zh_HK',
              reason: 'NONE',
            },
          },
        ],
      },
    ],
  }
}

describe('resolveRestaurant — WABA rung (TPL-009, third/last rung)', () => {
  let logs: Array<[string, string, unknown]>
  const log: LogFn = (level, event, data) => {
    logs.push([level, event, data])
  }

  beforeEach(() => {
    vi.clearAllMocks()
    logs = []
  })

  it('resolves a template-status payload with a known WABA to the restaurant id', async () => {
    vi.mocked(findByBusinessAccountId).mockResolvedValue({
      id: 'rest-kushiro',
    } as never)

    const id = await resolveRestaurant(templateStatusPayload(KNOWN_WABA), log)

    expect(id).toBe('rest-kushiro')
    expect(findByBusinessAccountId).toHaveBeenCalledWith(KNOWN_WABA)
  })

  it('unknown WABA → null + webhook.restaurant_not_found warn log', async () => {
    vi.mocked(findByBusinessAccountId).mockResolvedValue(null)

    const id = await resolveRestaurant(templateStatusPayload('unknown-waba'), log)

    expect(id).toBeNull()
    expect(logs).toContainEqual([
      'warn',
      'webhook.restaurant_not_found',
      { wabaId: 'unknown-waba' },
    ])
  })

  it('a phone-bearing payload never reaches the WABA rung', async () => {
    vi.mocked(findByPhoneNumberId).mockResolvedValue({ id: 'rest-phone' } as never)

    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: 'pnid-1' },
              },
            },
          ],
        },
      ],
    }

    const id = await resolveRestaurant(payload, log)

    expect(id).toBe('rest-phone')
    expect(findByBusinessAccountId).not.toHaveBeenCalled()
  })

  it('a display-phone-number payload never reaches the WABA rung', async () => {
    vi.mocked(findByDisplayPhoneNumber).mockResolvedValue({ id: 'rest-display' } as never)

    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                display_phone_number: '85291234567',
              },
            },
          ],
        },
      ],
    }

    const id = await resolveRestaurant(payload, log)

    expect(id).toBe('rest-display')
    expect(findByBusinessAccountId).not.toHaveBeenCalled()
  })

  it('display_phone_number present but unresolvable falls through to the WABA rung instead of short-circuiting null', async () => {
    // Regression guard: the display-phone rung must not `return null` before
    // the WABA rung gets a chance — a template-status payload can (in
    // principle) carry a stray display_phone_number-shaped field while its
    // real tenant key is the WABA id. See resolve-tenant.ts comment.
    vi.mocked(findByDisplayPhoneNumber).mockResolvedValue(null)
    vi.mocked(findByBusinessAccountId).mockResolvedValue({ id: 'rest-kushiro' } as never)

    const payload = {
      entry: [
        {
          id: KNOWN_WABA,
          changes: [
            {
              field: 'message_template_status_update',
              value: {
                display_phone_number: '85291234567',
                event: 'APPROVED',
                message_template_id: 1029650636326514,
                message_template_name: 'offer_promotion',
                message_template_language: 'zh_HK',
              },
            },
          ],
        },
      ],
    }

    const id = await resolveRestaurant(payload, log)

    expect(id).toBe('rest-kushiro')
  })

  it('no phone identifier and no WABA-shaped payload → null + webhook.no_phone_number_id', async () => {
    const id = await resolveRestaurant({ entry: [{ changes: [{ value: {} }] }] }, log)

    expect(id).toBeNull()
    expect(findByBusinessAccountId).not.toHaveBeenCalled()
    expect(logs).toContainEqual(['warn', 'webhook.no_phone_number_id', {}])
  })
})
