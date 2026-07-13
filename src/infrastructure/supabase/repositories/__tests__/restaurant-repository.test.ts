import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/client')

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import {
  getRestaurantRedirect,
  updateRestaurantRedirect,
  getFallbackHelpEnabled,
  updateFallbackHelpEnabled,
} from '../restaurant-repository'

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

describe('getFallbackHelpEnabled', () => {
  beforeEach(() => vi.clearAllMocks())

  it('selects the toggle column by id and returns the stored value', async () => {
    const { from, select, eq } = mockReadChain({
      data: { fallback_help_enabled: false },
      error: null,
    })

    const result = await getFallbackHelpEnabled('restaurant-1')

    expect(from).toHaveBeenCalledWith('restaurants')
    expect(select).toHaveBeenCalledWith('fallback_help_enabled')
    expect(eq).toHaveBeenCalledWith('id', 'restaurant-1')
    expect(result).toBe(false)
  })

  it('degrades ON (true) when the query errors', async () => {
    mockReadChain({ data: null, error: { message: 'boom' } })

    expect(await getFallbackHelpEnabled('restaurant-1')).toBe(true)
  })

  it('degrades ON (true) when the restaurant is not found', async () => {
    mockReadChain({ data: null, error: null })

    expect(await getFallbackHelpEnabled('missing')).toBe(true)
  })

  it('coalesces a null column to true (legacy row / direct-DB null)', async () => {
    mockReadChain({ data: { fallback_help_enabled: null }, error: null })

    expect(await getFallbackHelpEnabled('restaurant-1')).toBe(true)
  })
})

describe('updateFallbackHelpEnabled', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates fallback_help_enabled by id', async () => {
    const { from, update, eq } = mockWriteChain({ error: null })

    await updateFallbackHelpEnabled('restaurant-1', false)

    expect(from).toHaveBeenCalledWith('restaurants')
    expect(update).toHaveBeenCalledWith({ fallback_help_enabled: false })
    expect(eq).toHaveBeenCalledWith('id', 'restaurant-1')
  })

  it('throws when the update fails', async () => {
    mockWriteChain({ error: { message: 'update failed' } })

    await expect(
      updateFallbackHelpEnabled('restaurant-1', true)
    ).rejects.toThrow('update failed')
  })
})
