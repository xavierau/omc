import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { resolveProofSignedUrl } from '../resolve-proof-signed-url'

function buildSupabase(
  result: { signedUrl?: string; error?: { message: string } | null } = {}
) {
  const createSignedUrl = vi.fn().mockResolvedValue({
    data: result.signedUrl ? { signedUrl: result.signedUrl } : null,
    error: result.error ?? null,
  })
  const from = vi.fn().mockReturnValue({ createSignedUrl })
  return {
    client: { storage: { from } } as unknown as ReturnType<
      typeof createServerSupabaseClient
    >,
    createSignedUrl,
    from,
  }
}

describe('resolveProofSignedUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('mints a signed URL with default 5-minute TTL', async () => {
    const { client, createSignedUrl, from } = buildSupabase({
      signedUrl: 'https://example.com/u',
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    const url = await resolveProofSignedUrl('rest-1/abc.jpg')
    expect(url).toBe('https://example.com/u')
    expect(from).toHaveBeenCalledWith('consent-proof')
    expect(createSignedUrl).toHaveBeenCalledWith('rest-1/abc.jpg', 300)
  })

  it('honors a custom TTL when provided', async () => {
    const { client, createSignedUrl } = buildSupabase({
      signedUrl: 'https://example.com/u',
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    await resolveProofSignedUrl('rest-1/abc.jpg', 60)
    expect(createSignedUrl).toHaveBeenCalledWith('rest-1/abc.jpg', 60)
  })

  it('throws when storage returns an error', async () => {
    const { client } = buildSupabase({ error: { message: 'object missing' } })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    await expect(resolveProofSignedUrl('rest-1/x.jpg')).rejects.toThrow(
      /object missing/
    )
  })

  it('throws when storage returns no signed URL', async () => {
    const { client } = buildSupabase({})
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    await expect(resolveProofSignedUrl('rest-1/x.jpg')).rejects.toThrow(
      /sign(ed)? url/i
    )
  })
})
