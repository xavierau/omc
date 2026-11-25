// AGENT-006 AC-1: the campaign lookup behind get_recent_campaigns is scoped in
// SQL by the job restaurant AND the diner's member id, counts only sends Meta
// accepted, and returns one row per campaign (its latest send), newest first.
// Column existence is proven against the SQL by agent-schema-contract.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { recordingSupabase, filtersOf, type RecordedQuery } from '@/test-utils/recording-supabase'

vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: vi.fn() }))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { listAgentRecentCampaigns } from '../agent-campaign-repository'

const KEY = { restaurantId: 'rest-a', phone: '+85291234567' }
const QUERY = { sinceIso: '2026-10-26T00:00:00.000Z', limit: 3 }
const BODY = (text: string) => [{ type: 'BODY', text }]

type Result = { data?: unknown; error?: { message: string } | null }

/** recordingSupabase plus `.not(...)`, which the shared helper does not chain. */
function use(byTable: Record<string, Result>) {
  const rec = recordingSupabase((q: RecordedQuery) => byTable[q.table] ?? { data: null })
  const from = rec.client.from
  rec.client.from = (table: string) => {
    const chain = from(table) as Record<string, unknown>
    chain.not = (...args: unknown[]) => (rec.queries[rec.queries.length - 1].calls.push(['not', ...args]), chain)
    return chain as never
  }
  vi.mocked(createServerSupabaseClient).mockReturnValue(rec.client as never)
  return rec
}

const query = (rec: ReturnType<typeof use>, table: string) => rec.queries.find((q) => q.table === table)!
const send = (campaign: string, at: string, template: string | null, sentAt: string | null = at) => ({
  campaign_id: campaign,
  template_id: template,
  queued_at: at,
  sent_at: sentAt,
})

beforeEach(() => vi.clearAllMocks())

describe('AGENT-006 listAgentRecentCampaigns', () => {
  it('AC-1 not a member → [] after the member query alone', async () => {
    const rec = use({ members: { data: null } })
    expect(await listAgentRecentCampaigns(KEY, QUERY)).toEqual([])
    expect(rec.queries.map((q) => q.table)).toEqual(['members'])
    expect(filtersOf(rec.queries[0])).toEqual(['eq:restaurant_id=rest-a', 'eq:phone=+85291234567'])
  })

  it('AC-1 every query is scoped by the job restaurant; messages also by the member, outbound campaign sends Meta accepted, inside the window', async () => {
    const rec = use({
      members: { data: { id: 'm-1', points_balance: 0 } },
      whatsapp_messages: { data: [send('c-1', '2026-11-18T09:00:00.000Z', 't-1')] },
      campaigns: { data: [{ id: 'c-1', name: 'Sake night', whatsapp_template_id: 't-1' }] },
      whatsapp_templates: { data: [{ id: 't-1', components: BODY('HK$680 pp') }] },
    })
    await listAgentRecentCampaigns(KEY, QUERY)
    const messages = query(rec, 'whatsapp_messages')
    expect(filtersOf(messages)).toEqual([
      'eq:restaurant_id=rest-a',
      'eq:member_id=m-1',
      'eq:direction=outbound',
      'in:status=sent,delivered,read',
    ])
    expect(messages.calls).toContainEqual(['not', 'campaign_id', 'is', null])
    expect(messages.calls).toContainEqual(['gte', 'queued_at', QUERY.sinceIso])
    expect(messages.calls).toContainEqual(['order', 'queued_at', { ascending: false }])
    expect(filtersOf(query(rec, 'campaigns'))).toEqual(['eq:restaurant_id=rest-a', 'in:id=c-1'])
    expect(filtersOf(query(rec, 'whatsapp_templates'))).toEqual(['eq:restaurant_id=rest-a', 'in:id=t-1'])
  })

  it('AC-1 one row per campaign (its latest send), newest first, at most `limit`; template from the send, else the campaign', async () => {
    use({
      members: { data: { id: 'm-1', points_balance: 0 } },
      whatsapp_messages: {
        data: [
          send('c-1', '2026-11-18T09:00:05.000Z', null), // the coupon QR after the body
          send('c-1', '2026-11-18T09:00:00.000Z', 't-1'),
          send('c-2', '2026-11-10T09:00:00.000Z', null, null), // advanced to delivered before sent_at was written
          send('c-1', '2026-11-01T09:00:00.000Z', 't-1'),
          send('c-3', '2026-11-05T09:00:00.000Z', 't-3'),
          send('c-4', '2026-10-30T09:00:00.000Z', 't-4'),
        ],
      },
      campaigns: {
        data: [
          { id: 'c-3', name: 'Lunch set', whatsapp_template_id: 't-3' },
          { id: 'c-1', name: 'Sake night', whatsapp_template_id: 't-old' },
          { id: 'c-2', name: 'Oyster week', whatsapp_template_id: 't-2' },
        ],
      },
      whatsapp_templates: {
        data: [
          { id: 't-1', components: BODY('Sake HK$680') },
          { id: 't-2', components: BODY('Oysters HK$38 each') },
          { id: 't-3', components: 'not an array' },
        ],
      },
    })
    expect(await listAgentRecentCampaigns(KEY, QUERY)).toEqual([
      { campaignName: 'Sake night', sentAt: '2026-11-18T09:00:05.000Z', components: [{ type: 'BODY', text: 'Sake HK$680' }] },
      { campaignName: 'Oyster week', sentAt: '2026-11-10T09:00:00.000Z', components: [{ type: 'BODY', text: 'Oysters HK$38 each' }] },
      { campaignName: 'Lunch set', sentAt: '2026-11-05T09:00:00.000Z', components: [] },
    ])
  })

  it('AC-1 a campaign the tenant query does not return is dropped; no sends → no campaign or template query', async () => {
    let rec = use({
      members: { data: { id: 'm-1', points_balance: 0 } },
      whatsapp_messages: { data: [send('c-x', '2026-11-18T09:00:00.000Z', null)] },
      campaigns: { data: [] },
    })
    expect(await listAgentRecentCampaigns(KEY, QUERY)).toEqual([])
    expect(rec.queries.map((q) => q.table)).toEqual(['members', 'whatsapp_messages', 'campaigns'])

    rec = use({ members: { data: { id: 'm-1', points_balance: 0 } }, whatsapp_messages: { data: [] } })
    expect(await listAgentRecentCampaigns(KEY, QUERY)).toEqual([])
    expect(rec.queries.map((q) => q.table)).toEqual(['members', 'whatsapp_messages'])
  })

  it('AC-1 a failed read throws (the executor turns it into lookup_failed)', async () => {
    use({ members: { data: { id: 'm-1', points_balance: 0 } }, whatsapp_messages: { error: { message: 'boom' } } })
    await expect(listAgentRecentCampaigns(KEY, QUERY)).rejects.toThrow(/listAgentRecentCampaigns/)
  })
})
