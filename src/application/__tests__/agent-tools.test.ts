// AGENT-001 W1: the agent's tools are bound to the job and read-only (AC-R2, AC-R3).
import { describe, it, expect } from 'vitest'
import { AGENT_TOOL_DECLARATIONS, createAgentToolExecutor, declarationsFor } from '@/application/agent/agent-tools'
import { AGENT_TOOL_NAMES } from '@/domain/value-objects/agent-config'
import { FakeAgentStore, FakeClock, fakeToolData } from './agent-fakes'

const KEY = { restaurantId: 'rest-a', phone: '+85291234567' }

function executor(enabledTools = [...AGENT_TOOL_NAMES]) {
  const clock = new FakeClock()
  const store = new FakeAgentStore(clock)
  const data = fakeToolData()
  const execute = createAgentToolExecutor({ key: KEY, enabledTools, agentMode: 'auto', handoffSilenceHours: 12, now: clock.now, data, silences: store, booking: null })
  return { execute, data, store }
}

describe('AC-R2 tools are bound to the job context', () => {
  it('AC-R2 injected phone / restaurant / member args are ignored: the job’s own member is looked up', async () => {
    const { execute, data } = executor()
    const out = await execute('get_member_summary', { phone: '+85298887777', restaurant_id: 'rest-b', restaurantId: 'rest-b', member_id: 'm-other' })
    expect(data.calls).toEqual(['member:rest-a:+85291234567'])
    expect(out).toEqual({ member: true, pointsBalance: 120, stampCards: [] })
  })

  it('AC-R2 list_rewards and handoff use the job restaurant whatever the args say', async () => {
    const { execute, data, store } = executor()
    await execute('list_rewards', { restaurant_id: 'rest-b' })
    await execute('handoff_to_staff', { phone: '+85298887777' })
    expect(data.calls).toEqual(['rewards:rest-a', 'contact:rest-a'])
    expect([...store.silences.keys()]).toEqual(['rest-a|+85291234567'])
  })

  it('AC-R2 declarations take no parameters at all (every tool but AGENT-003 propose_booking / propose_booking_change / propose_booking_cancel, see AC-R12, AC-R21)', () => {
    const withArgs = ['propose_booking', 'propose_booking_change', 'propose_booking_cancel']
    for (const d of Object.values(AGENT_TOOL_DECLARATIONS).filter((d) => !withArgs.includes(d.name))) {
      expect(Object.keys(d).sort()).toEqual(['description', 'name'])
    }
  })
})

describe('AC-R3 only enabled, known, read-only tools run', () => {
  it.each(['award_points', 'redeem_reward', 'send_campaign', '', 'GET_MEMBER_SUMMARY'])(
    'AC-R3 unknown tool %j → error response, no impl invoked',
    async (name) => {
      const { execute, data, store } = executor()
      expect(await execute(name, {})).toEqual({ error: 'tool_not_available' })
      expect(data.calls).toEqual([])
      expect(store.silences.size).toBe(0)
    }
  )

  it('AC-R3 a known tool not in enabledTools → error response, no impl invoked', async () => {
    const { execute, data, store } = executor(['list_rewards'])
    expect(await execute('get_member_summary', {})).toEqual({ error: 'tool_not_available' })
    expect(await execute('handoff_to_staff', {})).toEqual({ error: 'tool_not_available' })
    expect(data.calls).toEqual([])
    expect(store.silences.size).toBe(0)
  })

  it('AC-R3 only enabled tools are declared to the model', () => {
    expect(declarationsFor(['handoff_to_staff', 'list_rewards']).map((d) => d.name)).toEqual(['list_rewards', 'handoff_to_staff'])
    expect(declarationsFor([])).toEqual([])
  })

  it('AC-R3 a failing lookup becomes an error response, never a throw', async () => {
    const { execute, data } = executor()
    data.getMemberSummary = async () => {
      throw new Error('db down')
    }
    expect(await execute('get_member_summary', {})).toEqual({ error: 'lookup_failed' })
  })

  it('handoff_to_staff silences the phone for handoffSilenceHours and returns the contact action', async () => {
    const { execute, store } = executor()
    const out = await execute('handoff_to_staff', {})
    expect(store.silences.get('rest-a|+85291234567')).toBe('2026-11-19T22:00:00.000Z')
    expect(out).toMatchObject({ handedOff: true, contactUrl: 'https://wa.me/85290000000', contactLabel: 'Chat with us' })
  })
})

describe('AGENT-006 get_recent_campaigns', () => {
  const BODY = (text: string) => ({ type: 'BODY' as const, text })

  it('AC-1 takes no parameters; bound to the job diner, the model args are ignored; window 30 days, at most 3', async () => {
    expect(Object.keys(AGENT_TOOL_DECLARATIONS.get_recent_campaigns).sort()).toEqual(['description', 'name'])
    const { execute, data } = executor()
    const out = await execute('get_recent_campaigns', { phone: '+85298887777', restaurantId: 'rest-b', member_id: 'm-other', limit: 50 })
    expect(data.calls).toEqual(['campaigns:rest-a:+85291234567:2026-10-20T10:00:00.000Z:3'])
    expect(out).toEqual({ campaigns: [] })
  })

  it('AC-1 returns {campaignName, sentAt, templateText}: header text + body + URL/phone buttons, placeholders left as-is', async () => {
    const { execute, data } = executor()
    data.campaignSends.push({
      campaignName: 'Sake night',
      sentAt: '2026-11-18T09:00:00.000Z',
      components: [
        { type: 'HEADER', format: 'TEXT', text: 'Sake pairing night' },
        { type: 'HEADER', format: 'IMAGE' },
        BODY('Hi {{customer_name}}, 30 Nov 7pm, HK$680 per person.'),
        { type: 'FOOTER', text: 'Reply STOP to opt out' },
        {
          type: 'BUTTONS',
          buttons: [
            { type: 'URL', text: 'Book now', url: 'https://example.test/book/{{1}}' },
            { type: 'PHONE_NUMBER', text: 'Call us', phoneNumber: '+85221234567' },
            { type: 'QUICK_REPLY', text: 'Not interested' },
          ],
        },
      ],
    })
    const out = (await execute('get_recent_campaigns', {})) as { campaigns: Array<Record<string, string>> }
    expect(out.campaigns).toEqual([
      {
        campaignName: 'Sake night',
        sentAt: '2026-11-18T09:00:00.000Z',
        templateText: [
          'Sake pairing night',
          'Hi {{customer_name}}, 30 Nov 7pm, HK$680 per person.',
          'Button "Book now": https://example.test/book/{{1}}',
          'Button "Call us": +85221234567',
        ].join('\n'),
      },
    ])
  })

  it('AC-1 templateText is truncated at 1500 characters', async () => {
    const { execute, data } = executor()
    data.campaignSends.push({ campaignName: 'Long', sentAt: '2026-11-18T09:00:00.000Z', components: [BODY('x'.repeat(4000))] })
    const out = (await execute('get_recent_campaigns', {})) as { campaigns: Array<{ templateText: string }> }
    expect(out.campaigns[0].templateText).toHaveLength(1500)
  })

  it('AC-1 not offered when not enabled: error, no lookup', async () => {
    const { execute, data } = executor(['list_rewards'])
    expect(await execute('get_recent_campaigns', {})).toEqual({ error: 'tool_not_available' })
    expect(data.calls).toEqual([])
  })
})
