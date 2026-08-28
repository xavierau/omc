import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/client')

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import {
  getRestaurantRedirect,
  updateRestaurantRedirect,
  getReplyConfig,
  updateReplyConfig,
  getContactConfig,
  updateContactConfig,
  getContactFlowId,
  getContactFlowIdStrict,
  updateContactFlowId,
  updateContactFlowIdIfEmpty,
  getRestaurantEmailContext,
} from '../restaurant-repository'
import { DEFAULT_REPLY_FEATURES } from '@/domain/services/reply-config'
import { DEFAULT_TOPICS, DEFAULT_LABELS } from '@/domain/services/contact-config'

function mockReadChain(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result)
  const eq = vi.fn().mockReturnValue({ single })
  const select = vi.fn().mockReturnValue({ eq })
  const from = vi.fn().mockReturnValue({ select })
  vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as never)
  return { from, select, eq, single }
}

function mockWriteChain(result: { error: unknown }) {
  const eq = vi.fn().mockResolvedValue(result)
  const update = vi.fn().mockReturnValue({ eq })
  const from = vi.fn().mockReturnValue({ update })
  vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as never)
  return { from, update, eq }
}

function mockConditionalWriteChain(result: { data: unknown; error: unknown }) {
  const select = vi.fn().mockResolvedValue(result)
  const is = vi.fn().mockReturnValue({ select })
  const eq = vi.fn().mockReturnValue({ is })
  const update = vi.fn().mockReturnValue({ eq })
  const from = vi.fn().mockReturnValue({ update })
  vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as never)
  return { from, update, eq, is, select }
}

describe('getRestaurantRedirect', () => {
  beforeEach(() => vi.clearAllMocks())

  it("selects redirect columns by id and returns the row's values", async () => {
    const { from, select, eq } = mockReadChain({
      data: { redirect_number: '+85291234567', redirect_label: 'Chat with us' },
      error: null,
    })

    const result = await getRestaurantRedirect('restaurant-1')

    expect(from).toHaveBeenCalledWith('restaurants')
    expect(select).toHaveBeenCalledWith('redirect_number, redirect_label')
    expect(eq).toHaveBeenCalledWith('id', 'restaurant-1')
    expect(result).toEqual({
      redirectNumber: '+85291234567',
      redirectLabel: 'Chat with us',
    })
  })

  it('returns the OFF fallback when the query errors', async () => {
    mockReadChain({ data: null, error: { message: 'boom' } })

    const result = await getRestaurantRedirect('restaurant-1')

    expect(result).toEqual({ redirectNumber: null, redirectLabel: 'Contact us' })
  })

  it('returns the OFF fallback when the restaurant is not found', async () => {
    mockReadChain({ data: null, error: null })

    const result = await getRestaurantRedirect('missing')

    expect(result).toEqual({ redirectNumber: null, redirectLabel: 'Contact us' })
  })

  it('falls back to the default label when the stored label is missing', async () => {
    mockReadChain({
      data: { redirect_number: '+85290000000', redirect_label: null },
      error: null,
    })

    const result = await getRestaurantRedirect('restaurant-1')

    expect(result).toEqual({
      redirectNumber: '+85290000000',
      redirectLabel: 'Contact us',
    })
  })

  it('clamps an over-length stored label to 20 chars (WhatsApp displayText/button limit)', async () => {
    mockReadChain({
      data: {
        redirect_number: '+85290000000',
        redirect_label: 'This label is definitely far too long',
      },
      error: null,
    })

    const result = await getRestaurantRedirect('restaurant-1')

    expect(result.redirectLabel).toBe('This label is defini')
    expect(result.redirectLabel.length).toBe(20)
  })
})

describe('updateRestaurantRedirect', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates redirect_number and redirect_label by id', async () => {
    const { from, update, eq } = mockWriteChain({ error: null })

    await updateRestaurantRedirect('restaurant-1', {
      redirectNumber: '+85291234567',
      redirectLabel: 'Chat with us',
    })

    expect(from).toHaveBeenCalledWith('restaurants')
    expect(update).toHaveBeenCalledWith({
      redirect_number: '+85291234567',
      redirect_label: 'Chat with us',
    })
    expect(eq).toHaveBeenCalledWith('id', 'restaurant-1')
  })

  it('persists a null number to clear the redirect', async () => {
    const { update } = mockWriteChain({ error: null })

    await updateRestaurantRedirect('restaurant-1', {
      redirectNumber: null,
      redirectLabel: 'Contact us',
    })

    expect(update).toHaveBeenCalledWith({
      redirect_number: null,
      redirect_label: 'Contact us',
    })
  })

  it('throws when the update fails', async () => {
    mockWriteChain({ error: { message: 'update failed' } })

    await expect(
      updateRestaurantRedirect('restaurant-1', {
        redirectNumber: '+85291234567',
        redirectLabel: 'Chat with us',
      })
    ).rejects.toThrow('update failed')
  })
})

describe('getReplyConfig', () => {
  beforeEach(() => vi.clearAllMocks())

  const ALL_TEXT_NULL = {
    unknown: { en: null, zh: null },
    help: { en: null, zh: null },
    join: { en: null, zh: null },
  }

  it('selects only reply_config by id', async () => {
    const { from, select, eq } = mockReadChain({
      data: { reply_config: {} },
      error: null,
    })

    await getReplyConfig('restaurant-1')

    expect(from).toHaveBeenCalledWith('restaurants')
    expect(select).toHaveBeenCalledWith('reply_config')
    expect(eq).toHaveBeenCalledWith('id', 'restaurant-1')
  })

  it('returns all-ON + null text for an empty blob', async () => {
    mockReadChain({ data: { reply_config: {} }, error: null })

    const result = await getReplyConfig('restaurant-1')

    expect(result).toEqual({ features: DEFAULT_REPLY_FEATURES, text: ALL_TEXT_NULL })
  })

  it('merges a partial stored blob over the defaults', async () => {
    mockReadChain({
      data: {
        reply_config: {
          features: { points: false },
          text: { unknown: { en: 'Try POINTS' } },
        },
      },
      error: null,
    })

    const result = await getReplyConfig('restaurant-1')

    expect(result.features).toEqual({
      points: false,
      rewards: true,
      redeem: true,
      card: true,
      help: true,
    })
    expect(result.text.unknown).toEqual({ en: 'Try POINTS', zh: null })
  })

  it('degrades to all-ON when the query errors', async () => {
    mockReadChain({ data: null, error: { message: 'boom' } })

    const result = await getReplyConfig('restaurant-1')

    expect(result.features).toEqual(DEFAULT_REPLY_FEATURES)
    expect(result.text).toEqual(ALL_TEXT_NULL)
  })

  it('degrades to all-ON when the restaurant is not found', async () => {
    mockReadChain({ data: null, error: null })

    const result = await getReplyConfig('missing')

    expect(result.features).toEqual(DEFAULT_REPLY_FEATURES)
  })
})

describe('updateReplyConfig', () => {
  beforeEach(() => vi.clearAllMocks())

  const CONFIG = {
    features: { points: false, rewards: true, redeem: true, card: false, help: true },
    text: {
      unknown: { en: 'Hi', zh: null },
      help: { en: null, zh: null },
      join: { en: null, zh: null },
    },
  }

  it('writes the reply_config blob by id', async () => {
    const { from, update, eq } = mockWriteChain({ error: null })

    await updateReplyConfig('restaurant-1', CONFIG)

    expect(from).toHaveBeenCalledWith('restaurants')
    expect(update).toHaveBeenCalledWith({ reply_config: CONFIG })
    expect(eq).toHaveBeenCalledWith('id', 'restaurant-1')
  })

  it('throws when the update fails', async () => {
    mockWriteChain({ error: { message: 'nope' } })

    await expect(updateReplyConfig('restaurant-1', CONFIG)).rejects.toThrow('nope')
  })
})

describe('getContactConfig', () => {
  beforeEach(() => vi.clearAllMocks())

  it('selects only contact_config by id', async () => {
    const { from, select, eq } = mockReadChain({
      data: { contact_config: {} },
      error: null,
    })

    await getContactConfig('restaurant-1')

    expect(from).toHaveBeenCalledWith('restaurants')
    expect(select).toHaveBeenCalledWith('contact_config')
    expect(eq).toHaveBeenCalledWith('id', 'restaurant-1')
  })

  it('returns redirect defaults for an empty blob', async () => {
    mockReadChain({ data: { contact_config: {} }, error: null })

    const result = await getContactConfig('restaurant-1')

    expect(result).toEqual({
      mode: 'redirect',
      notificationEmail: null,
      topics: DEFAULT_TOPICS,
      ackText: null,
      labels: DEFAULT_LABELS,
    })
  })

  it('resolves a fully-configured stored blob', async () => {
    const topics = ['A', 'B', 'C', 'D', 'E']
    mockReadChain({
      data: {
        contact_config: {
          mode: 'form',
          notificationEmail: 'owner@restaurant.hk',
          topics,
          ackText: 'Thanks!',
        },
      },
      error: null,
    })

    const result = await getContactConfig('restaurant-1')

    expect(result).toEqual({
      mode: 'form',
      notificationEmail: 'owner@restaurant.hk',
      topics,
      ackText: 'Thanks!',
      labels: DEFAULT_LABELS,
    })
  })

  it('degrades to redirect defaults when the query errors', async () => {
    mockReadChain({ data: null, error: { message: 'boom' } })

    const result = await getContactConfig('restaurant-1')

    expect(result.mode).toBe('redirect')
    expect(result.topics).toEqual(DEFAULT_TOPICS)
  })

  it('degrades to redirect defaults when the restaurant is not found', async () => {
    mockReadChain({ data: null, error: null })

    const result = await getContactConfig('missing')

    expect(result.mode).toBe('redirect')
  })

  it('degrades to redirect defaults instead of throwing when the client itself throws', async () => {
    vi.mocked(createServerSupabaseClient).mockImplementation(() => {
      throw new Error('connection failed')
    })

    const result = await getContactConfig('restaurant-1')

    expect(result).toEqual({
      mode: 'redirect',
      notificationEmail: null,
      topics: DEFAULT_TOPICS,
      ackText: null,
      labels: DEFAULT_LABELS,
    })
  })

  it('degrades to redirect defaults on a malformed (non-object) blob', async () => {
    mockReadChain({ data: { contact_config: 'garbage' }, error: null })

    const result = await getContactConfig('restaurant-1')

    expect(result.mode).toBe('redirect')
    expect(result.topics).toEqual(DEFAULT_TOPICS)
  })
})

describe('updateContactConfig', () => {
  beforeEach(() => vi.clearAllMocks())

  const CONFIG = {
    mode: 'form' as const,
    notificationEmail: 'owner@restaurant.hk',
    topics: ['A', 'B', 'C', 'D', 'E'],
    ackText: 'Thanks!',
    labels: DEFAULT_LABELS,
  }

  it('writes the contact_config blob by id', async () => {
    const { from, update, eq } = mockWriteChain({ error: null })

    await updateContactConfig('restaurant-1', CONFIG)

    expect(from).toHaveBeenCalledWith('restaurants')
    expect(update).toHaveBeenCalledWith({ contact_config: CONFIG })
    expect(eq).toHaveBeenCalledWith('id', 'restaurant-1')
  })

  it('throws when the update fails', async () => {
    mockWriteChain({ error: { message: 'nope' } })

    await expect(updateContactConfig('restaurant-1', CONFIG)).rejects.toThrow('nope')
  })
})

describe('getContactFlowId', () => {
  beforeEach(() => vi.clearAllMocks())

  it('selects only whatsapp_contact_flow_id by id', async () => {
    const { from, select, eq } = mockReadChain({
      data: { whatsapp_contact_flow_id: 'flow-123' },
      error: null,
    })

    await getContactFlowId('restaurant-1')

    expect(from).toHaveBeenCalledWith('restaurants')
    expect(select).toHaveBeenCalledWith('whatsapp_contact_flow_id')
    expect(eq).toHaveBeenCalledWith('id', 'restaurant-1')
  })

  it('returns the stored flow id', async () => {
    mockReadChain({ data: { whatsapp_contact_flow_id: 'flow-123' }, error: null })

    const result = await getContactFlowId('restaurant-1')

    expect(result).toBe('flow-123')
  })

  it('returns null when never deployed (column present, value null)', async () => {
    mockReadChain({ data: { whatsapp_contact_flow_id: null }, error: null })

    const result = await getContactFlowId('restaurant-1')

    expect(result).toBeNull()
  })

  it('returns null when the query errors', async () => {
    mockReadChain({ data: null, error: { message: 'boom' } })

    const result = await getContactFlowId('restaurant-1')

    expect(result).toBeNull()
  })

  it('returns null when the restaurant is not found', async () => {
    mockReadChain({ data: null, error: null })

    const result = await getContactFlowId('missing')

    expect(result).toBeNull()
  })

  it('returns null instead of throwing on a pre-059 database (column does not exist)', async () => {
    mockReadChain({
      data: null,
      error: { message: 'column restaurants.whatsapp_contact_flow_id does not exist' },
    })

    const result = await getContactFlowId('restaurant-1')

    expect(result).toBeNull()
  })

  it('returns null instead of throwing when the client itself throws', async () => {
    vi.mocked(createServerSupabaseClient).mockImplementation(() => {
      throw new Error('connection failed')
    })

    const result = await getContactFlowId('restaurant-1')

    expect(result).toBeNull()
  })
})

describe('updateContactFlowId', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes whatsapp_contact_flow_id by id', async () => {
    const { from, update, eq } = mockWriteChain({ error: null })

    await updateContactFlowId('restaurant-1', 'flow-123')

    expect(from).toHaveBeenCalledWith('restaurants')
    expect(update).toHaveBeenCalledWith({ whatsapp_contact_flow_id: 'flow-123' })
    expect(eq).toHaveBeenCalledWith('id', 'restaurant-1')
  })

  it('throws when the update fails', async () => {
    mockWriteChain({ error: { message: 'nope' } })

    await expect(updateContactFlowId('restaurant-1', 'flow-123')).rejects.toThrow('nope')
  })
})

describe('getContactFlowIdStrict', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the stored flow id', async () => {
    mockReadChain({ data: { whatsapp_contact_flow_id: 'flow-123' }, error: null })

    const result = await getContactFlowIdStrict('restaurant-1')

    expect(result).toBe('flow-123')
  })

  it('returns null when never deployed (column present, value null)', async () => {
    mockReadChain({ data: { whatsapp_contact_flow_id: null }, error: null })

    const result = await getContactFlowIdStrict('restaurant-1')

    expect(result).toBeNull()
  })

  it('throws instead of degrading to null when the query errors', async () => {
    mockReadChain({ data: null, error: { message: 'boom' } })

    await expect(getContactFlowIdStrict('restaurant-1')).rejects.toThrow('boom')
  })

  it('throws instead of degrading to null on a pre-059 database (column does not exist)', async () => {
    mockReadChain({
      data: null,
      error: { message: 'column restaurants.whatsapp_contact_flow_id does not exist' },
    })

    await expect(getContactFlowIdStrict('restaurant-1')).rejects.toThrow(
      'column restaurants.whatsapp_contact_flow_id does not exist'
    )
  })

  it('throws when the restaurant is not found', async () => {
    mockReadChain({ data: null, error: null })

    await expect(getContactFlowIdStrict('missing')).rejects.toThrow('Restaurant not found')
  })
})

describe('updateContactFlowIdIfEmpty', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes whatsapp_contact_flow_id only when it is still null, and reports the win', async () => {
    const { from, update, eq, is, select } = mockConditionalWriteChain({
      data: [{ id: 'restaurant-1' }],
      error: null,
    })

    const won = await updateContactFlowIdIfEmpty('restaurant-1', 'flow-123')

    expect(from).toHaveBeenCalledWith('restaurants')
    expect(update).toHaveBeenCalledWith({ whatsapp_contact_flow_id: 'flow-123' })
    expect(eq).toHaveBeenCalledWith('id', 'restaurant-1')
    expect(is).toHaveBeenCalledWith('whatsapp_contact_flow_id', null)
    expect(select).toHaveBeenCalledWith('id')
    expect(won).toBe(true)
  })

  it('reports losing the race when a concurrent writer already persisted a flow id', async () => {
    mockConditionalWriteChain({ data: [], error: null })

    const won = await updateContactFlowIdIfEmpty('restaurant-1', 'flow-123')

    expect(won).toBe(false)
  })

  it('throws when the update fails', async () => {
    mockConditionalWriteChain({ data: null, error: { message: 'nope' } })

    await expect(updateContactFlowIdIfEmpty('restaurant-1', 'flow-123')).rejects.toThrow('nope')
  })
})

describe('getRestaurantEmailContext', () => {
  beforeEach(() => vi.clearAllMocks())

  it('selects only name and whatsapp_number by id', async () => {
    const { from, select, eq } = mockReadChain({
      data: { name: 'Golden Dragon', whatsapp_number: '+85291234567' },
      error: null,
    })

    await getRestaurantEmailContext('restaurant-1')

    expect(from).toHaveBeenCalledWith('restaurants')
    expect(select).toHaveBeenCalledWith('name, whatsapp_number')
    expect(eq).toHaveBeenCalledWith('id', 'restaurant-1')
  })

  it("returns the row's name and whatsapp number", async () => {
    mockReadChain({
      data: { name: 'Golden Dragon', whatsapp_number: '+85291234567' },
      error: null,
    })

    const result = await getRestaurantEmailContext('restaurant-1')

    expect(result).toEqual({ name: 'Golden Dragon', whatsappNumber: '+85291234567' })
  })

  it('degrades to empty defaults when the query errors', async () => {
    mockReadChain({ data: null, error: { message: 'boom' } })

    const result = await getRestaurantEmailContext('restaurant-1')

    expect(result).toEqual({ name: '', whatsappNumber: null })
  })

  it('degrades to empty defaults when the restaurant is not found', async () => {
    mockReadChain({ data: null, error: null })

    const result = await getRestaurantEmailContext('missing')

    expect(result).toEqual({ name: '', whatsappNumber: null })
  })

  it('degrades to empty defaults instead of throwing when the client itself throws', async () => {
    vi.mocked(createServerSupabaseClient).mockImplementation(() => {
      throw new Error('connection failed')
    })

    const result = await getRestaurantEmailContext('restaurant-1')

    expect(result).toEqual({ name: '', whatsappNumber: null })
  })
})
