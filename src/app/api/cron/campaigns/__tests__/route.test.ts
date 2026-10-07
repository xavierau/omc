// Issue #95: nothing in prod ever called GET /api/cron/campaigns, so scheduled
// broadcasts never fired. Turning the Forge job on makes this route run every
// minute — these cover the enqueue lease that keeps a campaign which never
// leaves `active` from being re-enqueued on every tick forever.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/repositories/campaign-repository', () => ({
  getDueCampaigns: vi.fn(),
  claimCampaignForEnqueue: vi.fn(),
}))
vi.mock('@/infrastructure/queue/campaign-queue', () => ({
  addCampaignJob: vi.fn(),
}))
vi.mock('@/application/check-campaign-guardrails', () => ({
  checkCampaignGuardrails: vi.fn(),
}))

import {
  getDueCampaigns,
  claimCampaignForEnqueue,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { addCampaignJob } from '@/infrastructure/queue/campaign-queue'
import { checkCampaignGuardrails } from '@/application/check-campaign-guardrails'
import { GET } from '../route'

const SECRET = 'test-cron-secret'

function cronReq(auth: string | null = `Bearer ${SECRET}`): NextRequest {
  return new NextRequest('http://localhost/api/cron/campaigns', {
    headers: auth ? { authorization: auth } : {},
  })
}

function dueCampaign(id: string, restaurantId = 'rest-1') {
  return { id, restaurantId } as never
}

// The route only reads `allowed`; `usage` is required by the type but
// irrelevant here, so it stays a zeroed stub.
const ZERO_USAGE = {
  monthlySends: 0,
  monthlyLimit: 1000,
  dailyCampaigns: 0,
  dailyLimit: 10,
  unsubscribeRate: 0,
  maxUnsubscribeRate: 0.05,
  autoThrottleFactor: 1,
  autoPauseActive: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', SECRET)
  vi.mocked(getDueCampaigns).mockResolvedValue([])
  vi.mocked(claimCampaignForEnqueue).mockResolvedValue(true)
  vi.mocked(checkCampaignGuardrails).mockResolvedValue({
    allowed: true,
    violations: [],
    warnings: [],
    usage: ZERO_USAGE,
  })
})

describe('GET /api/cron/campaigns', () => {
  it('rejects a request without the cron secret', async () => {
    const r = await GET(cronReq(null))
    expect(r.status).toBe(401)
    expect(getDueCampaigns).not.toHaveBeenCalled()
  })

  it('rejects a request with the wrong cron secret', async () => {
    const r = await GET(cronReq('Bearer nope'))
    expect(r.status).toBe(401)
  })

  it('enqueues one job per due campaign', async () => {
    vi.mocked(getDueCampaigns).mockResolvedValue([
      dueCampaign('c-1'),
      dueCampaign('c-2', 'rest-2'),
    ])

    const r = await GET(cronReq())

    expect(await r.json()).toEqual({ enqueued: 2, skipped: 0, throttled: 0 })
    expect(addCampaignJob).toHaveBeenCalledTimes(2)
    expect(addCampaignJob).toHaveBeenCalledWith({
      campaignId: 'c-1',
      restaurantId: 'rest-1',
    })
  })

  it('does not enqueue when the enqueue lease is already held', async () => {
    vi.mocked(getDueCampaigns).mockResolvedValue([dueCampaign('c-1')])
    vi.mocked(claimCampaignForEnqueue).mockResolvedValue(false)

    const r = await GET(cronReq())

    expect(await r.json()).toEqual({ enqueued: 0, skipped: 0, throttled: 1 })
    expect(addCampaignJob).not.toHaveBeenCalled()
  })

  it('takes the lease before enqueueing, so a crash between the two cannot double-enqueue', async () => {
    const order: string[] = []
    vi.mocked(getDueCampaigns).mockResolvedValue([dueCampaign('c-1')])
    vi.mocked(claimCampaignForEnqueue).mockImplementation(async () => {
      order.push('claim')
      return true
    })
    vi.mocked(addCampaignJob).mockImplementation(async () => {
      order.push('enqueue')
    })

    await GET(cronReq())

    expect(order).toEqual(['claim', 'enqueue'])
  })

  it('skips a guardrail-blocked campaign without burning its lease', async () => {
    vi.mocked(getDueCampaigns).mockResolvedValue([dueCampaign('c-1')])
    vi.mocked(checkCampaignGuardrails).mockResolvedValue({
      allowed: false,
      violations: ['daily limit reached'],
      warnings: [],
      usage: ZERO_USAGE,
    })

    const r = await GET(cronReq())

    expect(await r.json()).toEqual({ enqueued: 0, skipped: 1, throttled: 0 })
    expect(claimCampaignForEnqueue).not.toHaveBeenCalled()
    expect(addCampaignJob).not.toHaveBeenCalled()
  })

  it('skips a campaign whose guardrail check throws rather than sending blind', async () => {
    vi.mocked(getDueCampaigns).mockResolvedValue([dueCampaign('c-1')])
    vi.mocked(checkCampaignGuardrails).mockRejectedValue(new Error('db down'))

    const r = await GET(cronReq())

    expect(await r.json()).toEqual({ enqueued: 0, skipped: 1, throttled: 0 })
    expect(addCampaignJob).not.toHaveBeenCalled()
  })

  it('fails the tick loudly when the lease query errors, rather than reading it as "lease held"', async () => {
    vi.mocked(getDueCampaigns).mockResolvedValue([dueCampaign('c-1')])
    vi.mocked(claimCampaignForEnqueue).mockRejectedValue(
      new Error('claimCampaignForEnqueue: column does not exist')
    )

    const r = await GET(cronReq())

    // A silent skip here would be issue #95 again: every scheduled send
    // quietly stops while the Forge job still reports success.
    expect(r.status).toBe(500)
    expect(addCampaignJob).not.toHaveBeenCalled()
  })

  it('returns 500 when the due-campaign query fails', async () => {
    vi.mocked(getDueCampaigns).mockRejectedValue(new Error('boom'))

    const r = await GET(cronReq())

    expect(r.status).toBe(500)
  })
})
