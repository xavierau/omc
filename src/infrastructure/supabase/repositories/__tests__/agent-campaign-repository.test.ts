// AGENT-006 AC-1: the campaign lookup behind get_recent_campaigns is scoped in
// SQL by the job restaurant AND the diner's member id, counts only sends Meta
// accepted, and returns one row per campaign (its latest send), newest first.
// Fix round 1: the text is the send's own template (flagged when edited after
// the send) or the campaign's inline text, never campaigns.whatsapp_template_id.
// Fix round 2: inline text only from an accepted plain-text send; a campaign seen
// only through its coupon-QR image, or whose carried template is not returned,
// is dropped (never text the diner did not receive).
// Column existence is proven against the SQL by agent-schema-contract.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { recordingSupabase, filtersOf, type RecordedQuery } from '@/test-utils/recording-supabase'

vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: vi.fn() }))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { listAgentRecentCampaigns } from '../agent-campaign-repository'

const KEY = { restaurantId: 'rest-a', phone: '+85291234567' }
const QUERY = { sinceIso: '2026-10-26T00:00:00.000Z', limit: 3 }
const BODY = (text: string) => [{ type: 'BODY', text }]
const INLINE = (zh: string | null, en: string | null, legacy = '') => ({ template_zh_hk: zh, template_en: en, template: legacy })

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
type MessageType = 'text' | 'image' | 'template' | 'interactive'
const send = (
  campaign: string,
  at: string,
  template: string | null,
  sentAt: string | null = at,
  type: MessageType = template ? 'template' : 'text'
) => ({
  campaign_id: campaign,
  template_id: template,
  message_type: type,
  queued_at: at,
  sent_at: sentAt,
})
/** The coupon-QR image a campaign sends after its body (execute-campaign-send sendCouponQr). */
const qr = (campaign: string, at: string) => send(campaign, at, null, at, 'image')

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
      members: { data: { id: 'm-1', preferred_language: 'en' } },
      whatsapp_messages: { data: [send('c-1', '2026-11-18T09:00:00.000Z', 't-1')] },
      campaigns: { data: [{ id: 'c-1', ...INLINE(null, null) }] },
      whatsapp_templates: { data: [{ id: 't-1', components: BODY('HK$680 pp'), updated_at: '2026-11-01T00:00:00.000Z' }] },
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

  it('AC-1 one row per campaign (its latest send), newest first, at most `limit`; the template only from the sends themselves', async () => {
    use({
      members: { data: { id: 'm-1', preferred_language: 'en' } },
      whatsapp_messages: {
        data: [
          qr('c-1', '2026-11-18T09:00:05.000Z'), // the coupon QR after the body
          send('c-1', '2026-11-18T09:00:00.000Z', 't-1'),
          send('c-2', '2026-11-10T09:00:00.000Z', null, null), // inline text, advanced to delivered before sent_at was written
          send('c-1', '2026-11-01T09:00:00.000Z', 't-1'),
          send('c-3', '2026-11-05T09:00:00.000Z', 't-3'),
          send('c-4', '2026-10-30T09:00:00.000Z', 't-4'),
        ],
      },
      campaigns: {
        data: [
          { id: 'c-3', ...INLINE(null, null) },
          { id: 'c-1', ...INLINE(null, null) },
          { id: 'c-2', ...INLINE('生蠔每隻 HK$38', 'Oysters HK$38 each') },
        ],
      },
      whatsapp_templates: {
        data: [
          { id: 't-1', components: BODY('Sake HK$680'), updated_at: '2026-11-02T00:00:00.000Z' },
          { id: 't-3', components: 'not an array', updated_at: '2026-11-01T00:00:00.000Z' },
        ],
      },
    })
    expect(await listAgentRecentCampaigns(KEY, QUERY)).toEqual([
      { sentAt: '2026-11-18T09:00:05.000Z', content: { kind: 'template', components: [{ type: 'BODY', text: 'Sake HK$680' }], editedAfterSend: false } },
      { sentAt: '2026-11-10T09:00:00.000Z', content: { kind: 'text', text: 'Oysters HK$38 each' } },
      { sentAt: '2026-11-05T09:00:00.000Z', content: { kind: 'template', components: [], editedAfterSend: false } },
    ])
  })

  it('AC-1 F1 an inline-text campaign returns its own text in the diner’s language: member language, else the restaurant default, else the other language', async () => {
    const run = async (preferred: string | null, campaign: ReturnType<typeof INLINE>, restaurantDefault = 'zh_hk') => {
      const rec = use({
        members: { data: { id: 'm-1', preferred_language: preferred } },
        whatsapp_messages: { data: [send('c-1', '2026-11-18T09:00:00.000Z', null)] },
        campaigns: { data: [{ id: 'c-1', ...campaign }] },
        restaurants: { data: { default_language: restaurantDefault } },
      })
      const [item] = await listAgentRecentCampaigns(KEY, QUERY)
      return { item, rec }
    }
    const both = INLINE('清酒之夜 每位 HK$680', 'Sake night HK$680 pp')
    expect((await run('en', both)).item.content).toEqual({ kind: 'text', text: 'Sake night HK$680 pp' })
    expect((await run('zh_hk', both)).item.content).toEqual({ kind: 'text', text: '清酒之夜 每位 HK$680' })
    expect((await run('zh_hk', INLINE(null, 'Sake night HK$680 pp'))).item.content).toEqual({ kind: 'text', text: 'Sake night HK$680 pp' })
    expect((await run('en', INLINE('', null, 'Legacy HK$500'))).item.content).toEqual({ kind: 'text', text: 'Legacy HK$500' })

    const noLanguage = await run(null, both)
    expect(noLanguage.item.content).toEqual({ kind: 'text', text: '清酒之夜 每位 HK$680' })
    expect(filtersOf(query(noLanguage.rec, 'restaurants'))).toEqual(['eq:id=rest-a'])
    expect((await run(null, both, 'en')).item.content).toEqual({ kind: 'text', text: 'Sake night HK$680 pp' })

    // The member's own language needs no restaurant read; no template read for a text send.
    const withLanguage = await run('en', both)
    expect(withLanguage.rec.queries.map((q) => q.table)).toEqual(['members', 'whatsapp_messages', 'campaigns'])
    expect(query(withLanguage.rec, 'members').calls).toContainEqual(['select', 'id, preferred_language'])
    expect(filtersOf(query(withLanguage.rec, 'campaigns'))).toEqual(['eq:restaurant_id=rest-a', 'in:id=c-1'])
  })

  it('AC-1 F2 a send without template_id never uses campaigns.whatsapp_template_id', async () => {
    const rec = use({
      members: { data: { id: 'm-1', preferred_language: 'en' } },
      whatsapp_messages: { data: [send('c-1', '2026-11-18T09:00:00.000Z', null)] },
      campaigns: { data: [{ id: 'c-1', whatsapp_template_id: 't-later', ...INLINE(null, 'Sake night HK$680 pp') }] },
      whatsapp_templates: { data: [{ id: 't-later', components: BODY('Edited HK$999'), updated_at: '2026-11-01T00:00:00.000Z' }] },
    })
    expect(await listAgentRecentCampaigns(KEY, QUERY)).toEqual([
      { sentAt: '2026-11-18T09:00:00.000Z', content: { kind: 'text', text: 'Sake night HK$680 pp' } },
    ])
    expect(rec.queries.map((q) => q.table)).not.toContain('whatsapp_templates')
    expect(String(query(rec, 'campaigns').calls.find(([m]) => m === 'select')?.[1])).not.toContain('whatsapp_template_id')
  })

  it('AC-1 F2 a template modified after the send that carried it is flagged editedAfterSend', async () => {
    const rec = use({
      members: { data: { id: 'm-1', preferred_language: 'en' } },
      whatsapp_messages: {
        data: [
          qr('c-1', '2026-11-18T09:00:05.000Z'),
          send('c-1', '2026-11-18T09:00:00.000Z', 't-1'),
          send('c-2', '2026-11-10T09:00:00.000Z', 't-2'),
        ],
      },
      campaigns: { data: [{ id: 'c-1', ...INLINE(null, null) }, { id: 'c-2', ...INLINE(null, null) }] },
      whatsapp_templates: {
        data: [
          // Edited 2 s after the body send it is compared with (the QR row is later still: not the reference).
          { id: 't-1', components: BODY('Sake HK$780'), updated_at: '2026-11-18T09:00:02.000000+00:00' },
          { id: 't-2', components: BODY('Oysters HK$38'), updated_at: '2026-11-09T23:59:59.999999+00:00' },
        ],
      },
    })
    const items = await listAgentRecentCampaigns(KEY, QUERY)
    expect(items.map((i) => i.content.kind === 'template' && i.content.editedAfterSend)).toEqual([true, false])
    expect(query(rec, 'whatsapp_templates').calls).toContainEqual(['select', 'id, components, updated_at'])
  })

  it('AC-1 N1 reads message_type on the sends', async () => {
    const rec = use({
      members: { data: { id: 'm-1', preferred_language: 'en' } },
      whatsapp_messages: { data: [send('c-1', '2026-11-18T09:00:00.000Z', null)] },
      campaigns: { data: [{ id: 'c-1', ...INLINE(null, 'Sake night HK$680 pp') }] },
    })
    await listAgentRecentCampaigns(KEY, QUERY)
    expect(String(query(rec, 'whatsapp_messages').calls.find(([m]) => m === 'select')?.[1])).toContain('message_type')
  })

  it('AC-1 N1 a template campaign seen only through its accepted coupon-QR image is dropped, never given the inline text', async () => {
    // The body (template) row went failed after the send, so the status filter leaves only the QR.
    const rec = use({
      members: { data: { id: 'm-1', preferred_language: 'en' } },
      whatsapp_messages: { data: [qr('c-1', '2026-11-18T09:00:05.000Z')] },
      campaigns: { data: [{ id: 'c-1', ...INLINE('每位 HK$680', 'HK$680 pp') }] },
      restaurants: { data: { default_language: 'zh_hk' } },
    })
    expect(await listAgentRecentCampaigns(KEY, QUERY)).toEqual([])
    expect(rec.queries.map((q) => q.table)).not.toContain('whatsapp_templates')
  })

  it('AC-1 N1 inline text only for an accepted text send without template_id; a QR next to that text send keeps the text', async () => {
    use({
      members: { data: { id: 'm-1', preferred_language: 'en' } },
      whatsapp_messages: {
        data: [
          qr('c-1', '2026-11-18T09:00:05.000Z'),
          send('c-1', '2026-11-18T09:00:00.000Z', null), // inline text body
          send('c-2', '2026-11-12T09:00:00.000Z', null, '2026-11-12T09:00:00.000Z', 'template'), // template type, no id
          send('c-3', '2026-11-11T09:00:00.000Z', null, '2026-11-11T09:00:00.000Z', 'interactive'),
        ],
      },
      campaigns: {
        data: [
          { id: 'c-1', ...INLINE(null, 'Oysters HK$38 each') },
          { id: 'c-2', ...INLINE(null, 'Sake HK$680 pp') },
          { id: 'c-3', ...INLINE(null, 'Wagyu HK$880') },
        ],
      },
    })
    expect(await listAgentRecentCampaigns(KEY, QUERY)).toEqual([
      { sentAt: '2026-11-18T09:00:05.000Z', content: { kind: 'text', text: 'Oysters HK$38 each' } },
    ])
  })

  it('AC-1 M1 a carried template the scoped template query does not return drops the item, never empty components claimed unedited', async () => {
    use({
      members: { data: { id: 'm-1', preferred_language: 'en' } },
      whatsapp_messages: { data: [send('c-1', '2026-11-18T09:00:00.000Z', 't-gone')] },
      campaigns: { data: [{ id: 'c-1', ...INLINE(null, 'HK$680 pp') }] },
      whatsapp_templates: { data: [] },
    })
    expect(await listAgentRecentCampaigns(KEY, QUERY)).toEqual([])
  })

  it('AC-1 N1/M1 a dropped campaign does not cost an older one its place in the `limit`', async () => {
    use({
      members: { data: { id: 'm-1', preferred_language: 'en' } },
      whatsapp_messages: {
        data: [
          qr('c-1', '2026-11-20T09:00:05.000Z'), // QR only: dropped
          send('c-2', '2026-11-19T09:00:00.000Z', 't-gone'), // template missing: dropped
          send('c-3', '2026-11-15T09:00:00.000Z', 't-3'),
          send('c-4', '2026-11-10T09:00:00.000Z', null),
          send('c-5', '2026-11-05T09:00:00.000Z', 't-5'),
          send('c-6', '2026-11-01T09:00:00.000Z', 't-5'),
        ],
      },
      campaigns: {
        data: ['c-1', 'c-2', 'c-3', 'c-4', 'c-5', 'c-6'].map((id) => ({ id, ...INLINE(null, `Inline ${id}`) })),
      },
      whatsapp_templates: {
        data: [
          { id: 't-3', components: BODY('Sake HK$680'), updated_at: '2026-11-01T00:00:00.000Z' },
          { id: 't-5', components: BODY('Oysters HK$38'), updated_at: '2026-10-01T00:00:00.000Z' },
        ],
      },
    })
    const items = await listAgentRecentCampaigns(KEY, QUERY)
    expect(items.map((i) => i.sentAt)).toEqual(['2026-11-15T09:00:00.000Z', '2026-11-10T09:00:00.000Z', '2026-11-05T09:00:00.000Z'])
    expect(items[1].content).toEqual({ kind: 'text', text: 'Inline c-4' })
  })

  it('AC-1 a campaign the tenant query does not return is dropped; no sends → no campaign or template query', async () => {
    let rec = use({
      members: { data: { id: 'm-1', preferred_language: 'en' } },
      whatsapp_messages: { data: [send('c-x', '2026-11-18T09:00:00.000Z', null)] },
      campaigns: { data: [] },
    })
    expect(await listAgentRecentCampaigns(KEY, QUERY)).toEqual([])
    expect(rec.queries.map((q) => q.table)).toEqual(['members', 'whatsapp_messages', 'campaigns'])

    rec = use({ members: { data: { id: 'm-1', preferred_language: 'en' } }, whatsapp_messages: { data: [] } })
    expect(await listAgentRecentCampaigns(KEY, QUERY)).toEqual([])
    expect(rec.queries.map((q) => q.table)).toEqual(['members', 'whatsapp_messages'])
  })

  it('AC-1 a failed read throws (the executor turns it into lookup_failed)', async () => {
    use({ members: { data: { id: 'm-1', preferred_language: 'en' } }, whatsapp_messages: { error: { message: 'boom' } } })
    await expect(listAgentRecentCampaigns(KEY, QUERY)).rejects.toThrow(/listAgentRecentCampaigns/)
  })
})
