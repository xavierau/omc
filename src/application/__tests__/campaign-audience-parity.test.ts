// CAMP-016 AC-4: count/send parity. For the same form inputs, the recipient
// count (POST /api/dashboard/campaigns/audience-count) and the send
// (resolveTargetMembers on the campaign created from those inputs) must call
// the 086 resolver with the same filter arguments. The SQL side — that
// campaign_audience_counts.will_receive equals the set campaign_audience_members
// returns for the same arguments, and that a selection by member ids equals the
// same selection saved as campaign_members — is asserted against a real
// Postgres in campaign-audience-rpcs.db.test.ts.
//
// The create path runs through the real snapshot parser, the real insert
// column mapping and the real row mapper; the row "stored" is the insert
// payload over the 086 column defaults, which is what Postgres keeps.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { Campaign } from '@/domain/entities/campaign'
import type { CampaignAudienceDefaults } from '@/domain/value-objects/audience-filters'

const mockRpc = vi.fn()
const mockFrom = vi.fn()
vi.mock('@/infrastructure/supabase/client', () => ({
  createServerSupabaseClient: vi.fn(() => ({ rpc: mockRpc, from: mockFrom })),
}))
vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/repositories/campaign-audience-defaults-repository', () => ({
  getAudienceDefaults: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/member-tag-repository', async () => {
  const actual = await vi.importActual<typeof import('@/infrastructure/supabase/repositories/member-tag-repository')>(
    '@/infrastructure/supabase/repositories/member-tag-repository'
  )
  return { ...actual, assertTagsBelongToTenant: vi.fn() }
})

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { getAudienceDefaults } from '@/infrastructure/supabase/repositories/campaign-audience-defaults-repository'
import { POST as COUNT } from '@/app/api/dashboard/campaigns/audience-count/route'
import { parseAudienceSnapshot } from '@/app/api/dashboard/campaigns/parse-audience-filters'
import {
  audienceInsertColumns,
  mapRowToCampaign,
} from '@/infrastructure/supabase/repositories/campaign-mapper'
import { resolveTargetMembers } from '@/application/resolve-campaign-members'

const RID = 'rest-1'
const TAGS = ['7a000001-0000-4000-8000-000000000001', '7a000002-0000-4000-8000-000000000002']
const MEMBERS = ['a0000001-0000-4000-8000-000000000001', 'a0000002-0000-4000-8000-000000000002']
const DEFAULTS: CampaignAudienceDefaults = { skipContactQuality: 'red', lapsedAfterDays: 30 }

type Body = Record<string, unknown>

/** Every call's RPC name + args, recorded. Counts return one row; members return one empty page. */
function recordRpc() {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  mockRpc.mockImplementation((name: string, args: Record<string, unknown>) => {
    calls.push({ name, args })
    if (name === 'campaign_audience_counts') {
      return Promise.resolve({ data: [{ audience: 0, after_lapsed: 0, green: 0, yellow: 0, red: 0, no_data: 0, will_receive: 0 }], error: null })
    }
    return Promise.resolve({ data: [], error: null })
  })
  return calls
}

function campaignTagsTable(tagIds: string[]) {
  mockFrom.mockImplementation((table: string) => {
    if (table !== 'campaign_tags') throw new Error(`unexpected from('${table}')`)
    return { select: () => ({ eq: async () => ({ data: tagIds.map((tag_id) => ({ tag_id })), error: null }) }) }
  })
}

/** What campaign create stores: the 086 defaults, overwritten by the insert payload. */
function createdCampaign(body: Body): Campaign {
  const snapshot = parseAudienceSnapshot(body, body.type, DEFAULTS)
  const row = {
    id: 'camp-new',
    restaurant_id: RID,
    type: body.type,
    template: 'hi',
    status: 'active',
    target_audience: body.targetAudience,
    audience_skip_quality: 'off',
    audience_lapsed_days: null,
    ...audienceInsertColumns({ restaurantId: RID, name: 'x', type: body.type as Campaign['type'], legacyTemplate: 'hi', ...snapshot }),
  }
  return mapRowToCampaign(row)
}

const without = (args: Record<string, unknown>, ...keys: string[]) =>
  Object.fromEntries(Object.entries(args).filter(([k]) => !keys.includes(k)))

async function countArgs(body: Body) {
  const calls = recordRpc()
  const res = await COUNT(new NextRequest('http://localhost/api/dashboard/campaigns/audience-count', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
  expect(res.status).toBe(200)
  return calls.find((c) => c.name === 'campaign_audience_counts')!.args
}

async function sendArgs(body: Body) {
  campaignTagsTable(body.targetAudience === 'tag' ? (body.tagIds as string[]) : [])
  const calls = recordRpc()
  await resolveTargetMembers(createdCampaign(body), RID)
  const call = calls.find((c) => c.name === 'campaign_audience_members')!
  return without(call.args, 'p_limit', 'p_after_id')
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getTenantContext).mockResolvedValue({ userId: 'u', restaurantId: RID, role: 'staff', tenantStatus: 'active' } as never)
  vi.mocked(getAudienceDefaults).mockResolvedValue(DEFAULTS)
})

const audiences: Body[] = [
  { targetAudience: 'all' },
  { targetAudience: 'tag', tagIds: TAGS },
]
const filters: Body[] = [
  { audienceSkipQuality: 'off', audienceLapsedDays: null },
  { audienceSkipQuality: 'red', audienceLapsedDays: 30 },
  { audienceSkipQuality: 'red_yellow', audienceLapsedDays: 120 },
  {}, // omitted → tenant defaults, on both paths
]

describe('count/send parity (CAMP-016 AC-4)', () => {
  for (const type of ['promo', 'winback']) {
    for (const audience of audiences) {
      for (const filter of filters) {
        const body = { type, ...audience, ...filter }
        it(`same resolver arguments for ${JSON.stringify(body)}`, async () => {
          expect(await sendArgs(body)).toEqual(await countArgs(body))
        })
      }
    }
  }

  it('selected: same filters; the count passes the ids, the send the saved selection', async () => {
    const body = { type: 'promo', targetAudience: 'selected', memberIds: MEMBERS, audienceSkipQuality: 'red', audienceLapsedDays: 30 }
    const count = await countArgs(body)
    const send = await sendArgs(body)
    expect(count.p_member_ids).toEqual(MEMBERS)
    expect(send).toMatchObject({ p_member_ids: null, p_campaign_id: 'camp-new' })
    expect(without(send, 'p_member_ids', 'p_campaign_id')).toEqual(without(count, 'p_member_ids', 'p_campaign_id'))
  })

  // r3 F7: one BROADCAST_TYPES definition — an 'all' audience for a type the
  // send never broadcasts (birthday) counts zero, as the send resolves nobody.
  it("'all' for a non-broadcast type counts zero and sends to nobody", async () => {
    const body = { type: 'birthday', targetAudience: 'all', audienceSkipQuality: 'red', audienceLapsedDays: 30 }
    const calls = recordRpc()
    const res = await COUNT(new NextRequest('http://localhost/api/dashboard/campaigns/audience-count', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ audience: 0, afterLapsed: 0, green: 0, yellow: 0, red: 0, noData: 0, willReceive: 0 })
    expect(calls).toEqual([])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await resolveTargetMembers(createdCampaign(body), RID)).toEqual([])
    warn.mockRestore()
    expect(calls).toEqual([])
  })

  it('a win-back always sends with a lapsed filter, even if the form sent none', async () => {
    const send = await sendArgs({ type: 'winback', targetAudience: 'tag', tagIds: TAGS, audienceLapsedDays: null })
    expect(send).toMatchObject({ p_lapsed_days: 30, p_never_visited_lapsed: true })
  })
})
