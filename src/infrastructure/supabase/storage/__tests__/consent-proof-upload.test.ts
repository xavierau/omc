import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { uploadConsentProof } from '../consent-proof-upload'
import { ProofUploadValidationError } from '../__errors__/proof-upload-errors'

const RESTAURANT_ID = 'rest-1'

interface StubStorage {
  upload: ReturnType<typeof vi.fn>
  createSignedUrl: ReturnType<typeof vi.fn>
}

function buildSupabase(stub: Partial<StubStorage> = {}): {
  client: ReturnType<typeof createServerSupabaseClient>
  storage: StubStorage
} {
  const upload = stub.upload ?? vi.fn().mockResolvedValue({ error: null })
  const createSignedUrl =
    stub.createSignedUrl ??
    vi
      .fn()
      .mockResolvedValue({
        data: { signedUrl: 'https://example.com/signed' },
        error: null,
      })
  const from = vi.fn().mockReturnValue({ upload, createSignedUrl })
  return {
    client: { storage: { from } } as unknown as ReturnType<
      typeof createServerSupabaseClient
    >,
    storage: { upload, createSignedUrl },
  }
}

function file(
  overrides: Partial<{ bytes: Buffer; mimeType: string; originalName: string }> = {}
) {
  return {
    bytes: overrides.bytes ?? Buffer.from('test-bytes'),
    mimeType: overrides.mimeType ?? 'image/jpeg',
    originalName: overrides.originalName ?? 'proof.jpg',
  }
}

describe('uploadConsentProof', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects unsupported mime types', async () => {
    const { client } = buildSupabase()
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    await expect(
      uploadConsentProof({
        restaurantId: RESTAURANT_ID,
        file: file({ mimeType: 'text/plain' }),
      })
    ).rejects.toMatchObject({
      name: 'ProofUploadValidationError',
      reason: 'unsupported_mime',
    })
  })

  it('rejects files larger than 10MB', async () => {
    const { client } = buildSupabase()
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    const big = Buffer.alloc(10 * 1024 * 1024 + 1)
    await expect(
      uploadConsentProof({
        restaurantId: RESTAURANT_ID,
        file: file({ bytes: big }),
      })
    ).rejects.toBeInstanceOf(ProofUploadValidationError)
  })

  it('uploads to consent-proof bucket under tenant prefix and returns signed URL', async () => {
    const { client, storage } = buildSupabase()
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    const result = await uploadConsentProof({
      restaurantId: RESTAURANT_ID,
      file: file({ mimeType: 'application/pdf', originalName: 'p.pdf' }),
    })
    expect(result.storagePath.startsWith(`${RESTAURANT_ID}/`)).toBe(true)
    expect(result.storagePath.endsWith('.pdf')).toBe(true)
    expect(result.signedUrl).toBe('https://example.com/signed')
    expect(client.storage.from).toHaveBeenCalledWith('consent-proof')
    expect(storage.upload).toHaveBeenCalledTimes(1)
    expect(storage.createSignedUrl).toHaveBeenCalledWith(
      result.storagePath,
      300
    )
  })

  it('throws when storage upload fails', async () => {
    const upload = vi
      .fn()
      .mockResolvedValue({ error: { message: 'disk full' } })
    const { client } = buildSupabase({ upload })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    await expect(
      uploadConsentProof({ restaurantId: RESTAURANT_ID, file: file() })
    ).rejects.toThrow(/disk full/)
  })

  it('throws when signed URL minting fails', async () => {
    const createSignedUrl = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'no key' } })
    const { client } = buildSupabase({ createSignedUrl })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    await expect(
      uploadConsentProof({ restaurantId: RESTAURANT_ID, file: file() })
    ).rejects.toThrow(/no key/)
  })

  it('accepts all allowed mime types (jpeg/png/webp/pdf)', async () => {
    const { client } = buildSupabase()
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    const mimes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
    for (const mimeType of mimes) {
      const r = await uploadConsentProof({
        restaurantId: RESTAURANT_ID,
        file: file({ mimeType }),
      })
      expect(r.storagePath).toContain(`${RESTAURANT_ID}/`)
    }
  })
})
