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
  getRestaurantEmailContext,
} from '../restaurant-repository'
import { DEFAULT_REPLY_FEATURES } from '@/domain/services/reply-config'
import { DEFAULT_TOPICS } from '@/domain/services/contact-config'

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
