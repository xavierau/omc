import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * FIX 1: `parseImageUrl` hardens campaign-image URL validation against SSRF
 * / tenant-leak attacks that the previous substring regex allowed. These
 * tests cover the attacker-host, userinfo, scheme, parse-failure, and
 * tenant-mismatch branches independently of the POST/PATCH routes.
 */

const RESTAURANT_ID = 'rest-1'

async function importWithEnv(supabaseUrl: string | null) {
  vi.resetModules()
  if (supabaseUrl === null) {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
  } else {
    process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl
  }
  const mod = await import('../parse-image-url')
  const errMod = await import('../parse-create-body-errors')
  return { parseImageUrl: mod.parseImageUrl, CampaignBodyError: errMod.CampaignBodyError }
}

describe('parseImageUrl — attacker-host SSRF protection (SUPABASE_HOST set)', () => {
  const ORIGINAL_ENV = process.env.NEXT_PUBLIC_SUPABASE_URL

  beforeEach(async () => {
    // Reload module with the trusted host baked in.
  })
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
    else process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_ENV
    vi.resetModules()
  })

  it('rejects an attacker-controlled host even when pathname looks valid', async () => {
    const { parseImageUrl, CampaignBodyError } = await importWithEnv(
      'https://trusted.supabase.co'
    )
    expect(() =>
      parseImageUrl(
        `https://evil.com/storage/v1/object/public/campaign-images/${RESTAURANT_ID}/x.png`,
        RESTAURANT_ID
      )
    ).toThrow(CampaignBodyError)
  })

  it('accepts a URL on the trusted Supabase host with correct tenant', async () => {
    const { parseImageUrl } = await importWithEnv('https://trusted.supabase.co')
    const url = `https://trusted.supabase.co/storage/v1/object/public/campaign-images/${RESTAURANT_ID}/c/en.png`
    expect(parseImageUrl(url, RESTAURANT_ID)).toBe(url)
  })

  it('rejects the correct host when the tenant segment is wrong', async () => {
    const { parseImageUrl, CampaignBodyError } = await importWithEnv(
      'https://trusted.supabase.co'
    )
    expect(() =>
      parseImageUrl(
        'https://trusted.supabase.co/storage/v1/object/public/campaign-images/other-tenant/x.png',
        RESTAURANT_ID
      )
    ).toThrow(CampaignBodyError)
  })
})

describe('parseImageUrl — scheme, userinfo, parse errors', () => {
  const ORIGINAL_ENV = process.env.NEXT_PUBLIC_SUPABASE_URL
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
    else process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_ENV
    vi.resetModules()
  })

  it('rejects http:// (non-https scheme)', async () => {
    const { parseImageUrl, CampaignBodyError } = await importWithEnv(null)
    expect(() =>
      parseImageUrl(
        `http://host/storage/v1/object/public/campaign-images/${RESTAURANT_ID}/x.png`,
        RESTAURANT_ID
      )
    ).toThrow(CampaignBodyError)
  })

  it('rejects URLs carrying userinfo', async () => {
    const { parseImageUrl, CampaignBodyError } = await importWithEnv(null)
    expect(() =>
      parseImageUrl(
        `https://user:pass@host/storage/v1/object/public/campaign-images/${RESTAURANT_ID}/x.png`,
        RESTAURANT_ID
      )
    ).toThrow(CampaignBodyError)
  })

  it('rejects values that are not parseable URLs', async () => {
    const { parseImageUrl, CampaignBodyError } = await importWithEnv(null)
    expect(() => parseImageUrl('::::not a url::::', RESTAURANT_ID)).toThrow(
      CampaignBodyError
    )
  })

  it('returns null for empty string / non-string input', async () => {
    const { parseImageUrl } = await importWithEnv(null)
    expect(parseImageUrl('', RESTAURANT_ID)).toBeNull()
    expect(parseImageUrl('   ', RESTAURANT_ID)).toBeNull()
    expect(parseImageUrl(undefined, RESTAURANT_ID)).toBeNull()
    expect(parseImageUrl(42, RESTAURANT_ID)).toBeNull()
  })

  it('accepts any host when SUPABASE_HOST is unset, still enforcing tenant', async () => {
    const { parseImageUrl, CampaignBodyError } = await importWithEnv(null)
    const ok = `https://host/storage/v1/object/public/campaign-images/${RESTAURANT_ID}/x.png`
    expect(parseImageUrl(ok, RESTAURANT_ID)).toBe(ok)
    expect(() =>
      parseImageUrl(
        'https://host/storage/v1/object/public/campaign-images/other/x.png',
        RESTAURANT_ID
      )
    ).toThrow(CampaignBodyError)
  })
})
