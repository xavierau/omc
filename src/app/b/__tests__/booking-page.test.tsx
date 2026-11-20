import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { FakeBookingSettings, FakeBookingTokens } from '@/test-utils/fake-booking'
import type { ResolveBookingLinkDeps } from '@/application/booking/resolve-booking-link'

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}))
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`)
})
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url) }))
const holder: { deps: ResolveBookingLinkDeps | null } = { deps: null }
vi.mock('@/application/booking/booking-deps', () => ({ resolveBookingLinkDeps: () => holder.deps }))

import BookingLinkPage, { metadata, dynamic } from '../[token]/page'
import { bookingHeaderRules } from '../booking-security-headers'
import { PRIVACY_URL } from '@/components/booking/collection-statement'

const A = 'rest-a'
const PHONE = '+85291234567'
const TOKEN = 'A'.repeat(43)

let tokens: FakeBookingTokens
let settings: FakeBookingSettings

beforeEach(() => {
  redirect.mockClear()
  tokens = new FakeBookingTokens()
  tokens.add({ token: TOKEN, restaurantId: A, phone: PHONE, source: 'campaign', campaignId: 'camp-1' })
  settings = new FakeBookingSettings()
  settings.restaurants.set(A, { name: 'Kushiro', logoUrl: null, whatsappNumber: '+85220000001' })
  settings.setConfig(A, { mode: 'simple' })
  holder.deps = { tokens, settings, now: () => new Date('2026-11-12T02:00:00.000Z') }
})

async function render(token = TOKEN, searchParams: Record<string, string> = {}) {
  const props = { params: Promise.resolve({ token }), searchParams: Promise.resolve(searchParams) }
  const element = await BookingLinkPage(props as never)
  return renderToStaticMarkup(element)
}

describe('/b/[token] page', () => {
  it('R10: shows only the last 4 digits of the diner number', async () => {
    const html = await render()
    expect(html).toContain('•••• 4567')
    expect(html).not.toContain(PHONE)
    expect(html).not.toContain('91234567')
  })

  it('AC-9: simple mode renders the form with the restaurant name and no phone input', async () => {
    const html = await render()
    expect(html).toContain('data-testid="booking-form"')
    expect(html).toContain('Kushiro')
    expect(html).not.toMatch(/name="phone"/)
  })

  it('R18: shows the collection statement in zh-HK and en with the privacy link', async () => {
    const html = await render()
    expect(html).toContain('lang="zh-HK"')
    expect(html).toContain('只會交給Kushiro')
    expect(html).toContain('lang="en"')
    expect(html).toContain('go only to Kushiro, to handle this')
    expect(html.split(`href="${PRIVACY_URL}"`)).toHaveLength(3)
  })

  it('R7: the page loads no script and is not indexable or cacheable', async () => {
    const html = await render()
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/fonts\.googleapis|googletagmanager|analytics/i)
    expect(dynamic).toBe('force-dynamic')
    expect(metadata.robots).toEqual({ index: false, follow: false })
    expect(metadata.referrer).toBe('no-referrer')
    const rules = bookingHeaderRules()
    for (const source of ['/b/:path*', '/api/b/:path*']) {
      const headers = Object.fromEntries(rules.find((r) => r.source === source)!.headers.map((h) => [h.key, h.value]))
      expect(headers['Cache-Control']).toContain('no-store')
      expect(headers['Referrer-Policy']).toBe('no-referrer')
      expect(headers['X-Robots-Tag']).toContain('noindex')
    }
  })

  it('R15: external mode redirects to the stored campaign URL whatever ?url= or ?next= say', async () => {
    settings.setConfig(A, { mode: 'external', externalUrl: 'https://inline.app/default' })
    settings.campaignUrls.set('camp-1', { restaurantId: A, url: 'https://inline.app/campaign' })
    await expect(render(TOKEN, { url: 'https://evil.example', next: 'https://evil.example' })).rejects.toThrow(
      'NEXT_REDIRECT:https://inline.app/campaign'
    )
    expect(redirect).toHaveBeenCalledWith('https://inline.app/campaign')
  })

  it('R15: without a campaign URL it redirects to the restaurant default, never the query', async () => {
    tokens.rows[0].campaignId = null
    settings.setConfig(A, { mode: 'external', externalUrl: 'https://inline.app/default' })
    await expect(render(TOKEN, { url: 'https://evil.example' })).rejects.toThrow('NEXT_REDIRECT:https://inline.app/default')
  })

  it('AC-3: off mode shows the unavailable page with the BOOK deep link and no form', async () => {
    settings.setConfig(A, { mode: 'off' })
    const html = await render()
    expect(html).toContain('data-reason="off"')
    expect(html).toContain('href="https://wa.me/85220000001?text=BOOK"')
    expect(html).not.toContain('booking-form')
  })

  it.each([
    ['expired', { expiresAt: '2026-11-12T01:00:00.000Z' }],
    ['consumed', { consumedAt: '2026-11-12T01:00:00.000Z' }],
  ])('AC-12: a %s link shows its explanation and no form', async (state, patch) => {
    Object.assign(tokens.rows[0], patch)
    const html = await render()
    expect(html).toContain(`data-reason="${state}"`)
    expect(html).toContain('booking.askOnWhatsapp')
    expect(html).not.toContain('booking-form')
  })

  it('AC-12: an unknown link shows the manual instruction and no restaurant', async () => {
    const html = await render('Z'.repeat(43))
    expect(html).toContain('data-reason="unknown"')
    expect(html).toContain('booking.askOnWhatsappManual')
    expect(html).not.toContain('Kushiro')
  })
})

describe('R3: booking UI never renders diner text as HTML', () => {
  it('has no dangerouslySetInnerHTML in any booking component or page', () => {
    const roots = ['src/components/booking', 'src/app/b', 'src/app/dashboard/bookings']
    const files = [
      ...roots.flatMap((dir) =>
        fs.readdirSync(dir, { recursive: true }).map((f) => path.join(dir, String(f))).filter((f) => /\.tsx?$/.test(f))
      ),
      'src/components/dashboard/booking-row.tsx',
      'src/components/dashboard/booking-list.tsx',
      'src/components/dashboard/booking-settings-section.tsx',
    ].filter((f) => !f.includes('__tests__'))
    expect(files.length).toBeGreaterThan(5)
    for (const file of files) expect(fs.readFileSync(file, 'utf8'), file).not.toContain('dangerouslySetInnerHTML')
  })
})
