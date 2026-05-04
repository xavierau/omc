import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/idempotency', () => ({
  tryMarkProcessed: vi.fn(),
}))
vi.mock(
  '@/infrastructure/supabase/repositories/quality-state-repository',
  () => ({
    insertEvent: vi.fn(),
  })
)

import { tryMarkProcessed } from '@/infrastructure/supabase/idempotency'
import { insertEvent } from '@/infrastructure/supabase/repositories/quality-state-repository'
import { routeQualityEvent } from '../quality-handlers'
import type { LogFn } from '@/domain/ports/whatsapp-webhooks'

function metaQualityBody(opts: {
  field?: string
  phoneNumberId?: string
  quality?: string
  currentLimit?: string
} = {}) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA-1',
        changes: [
          {
            field: opts.field ?? 'account_update',
            value: {
              event: 'account_quality_update',
              phone_number_id: opts.phoneNumberId ?? 'pn-1',
              quality: opts.quality ?? 'yellow',
              current_limit: opts.currentLimit ?? 'TIER_1K',
            },
          },
        ],
      },
    ],
  }
}

describe('routeQualityEvent', () => {
  let logs: Array<[string, string, unknown]>
  const log: LogFn = (level, event, data) => {
    logs.push([level, event, data])
  }

  beforeEach(() => {
    vi.clearAllMocks()
    logs = []
  })

  it('happy path: claims idempotency, inserts event, logs quality_event', async () => {
    vi.mocked(tryMarkProcessed).mockResolvedValue('new')
    vi.mocked(insertEvent).mockResolvedValue(undefined)

    await routeQualityEvent(metaQualityBody(), 'rest-1', log)

    expect(tryMarkProcessed).toHaveBeenCalledTimes(1)
    const claimedKey = vi.mocked(tryMarkProcessed).mock.calls[0]?.[0]
    expect(claimedKey).toMatch(/^account_quality:pn-1:/)

    expect(insertEvent).toHaveBeenCalledTimes(1)
    const insertedEvent = vi.mocked(insertEvent).mock.calls[0]?.[0]
    expect(insertedEvent.snapshot.restaurantId).toBe('rest-1')
    expect(insertedEvent.snapshot.phoneNumberId).toBe('pn-1')
    expect(insertedEvent.snapshot.qualityRating).toBe('YELLOW')
    expect(insertedEvent.snapshot.messagingTier).toBe('TIER_1K')

    const logEntry = logs.find((l) => l[1] === 'webhook.quality_event')
    expect(logEntry).toBeDefined()
    expect(logEntry?.[2]).toMatchObject({
      qualityRating: 'YELLOW',
      messagingTier: 'TIER_1K',
      flagged: false,
    })
  })

  it('returns early on duplicate idempotency claim (no insert)', async () => {
    vi.mocked(tryMarkProcessed).mockResolvedValue('duplicate')

    await routeQualityEvent(metaQualityBody(), 'rest-1', log)

    expect(insertEvent).not.toHaveBeenCalled()
  })

  it('throws idempotency.error so route.ts returns 500 / Kapso retries', async () => {
    vi.mocked(tryMarkProcessed).mockResolvedValue('error')

    await expect(
      routeQualityEvent(metaQualityBody(), 'rest-1', log)
    ).rejects.toThrow(/^idempotency\.error/)

    expect(insertEvent).not.toHaveBeenCalled()
  })

  it('no quality entries: logs ignored and does not call repo or claim', async () => {
    await routeQualityEvent({ foo: 'bar' }, 'rest-1', log)

    expect(tryMarkProcessed).not.toHaveBeenCalled()
    expect(insertEvent).not.toHaveBeenCalled()
    const ignored = logs.find((l) => l[1] === 'webhook.quality_event_ignored')
    expect(ignored).toBeDefined()
  })

  it('falls back to phoneNumberId="unknown" in idempotency key when missing', async () => {
    vi.mocked(tryMarkProcessed).mockResolvedValue('new')
    vi.mocked(insertEvent).mockResolvedValue(undefined)

    const body = {
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

    // The handler still needs phoneNumberId on the entity; we use a per-tenant
    // fallback so we don't drop the event entirely. Test expectation: the
    // claim key uses 'unknown' and the inserted entity uses the restaurantId
    // as a synthetic phone identifier.
    await routeQualityEvent(body, 'rest-1', log)

    const claimedKey = vi.mocked(tryMarkProcessed).mock.calls[0]?.[0]
    expect(claimedKey).toMatch(/^account_quality:unknown:/)
    expect(insertEvent).toHaveBeenCalledTimes(1)
  })
})
