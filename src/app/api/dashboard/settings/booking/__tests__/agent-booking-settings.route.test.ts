// BOOK-003 (R43): agent booking settings are tenant-admin only — toggle +
// website host, rotate (old id → 404 at once), poppy.json download. Uses an
// in-memory booking_config with the same CAS change the repository applies.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/application/booking/booking-deps', () => ({ agentBookingSettingsDeps: vi.fn() }))

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { agentBookingSettingsDeps } from '@/application/booking/booking-deps'
import { DEFAULT_BOOKING_CONFIG, type BookingConfig } from '@/domain/value-objects/booking-config'
import { resolveAgentBookingTenant } from '@/application/booking/resolve-agent-booking-tenant'
import { scriptedSecrets } from '@/application/booking/__tests__/fake-agent-booking'
import { PUT } from '../agent/route'
import { POST as ROTATE } from '../agent/rotate/route'
import { GET as DOWNLOAD } from '../poppy-json/route'

const RID = 'rest-1'
let config: BookingConfig

const put = (body: unknown) =>
  PUT(new NextRequest('http://localhost/api/dashboard/settings/booking/agent', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))

function as(role: string) {
  vi.mocked(getTenantContext).mockResolvedValue({ userId: 'u-1', restaurantId: RID, role, tenantStatus: 'active' })
}

const directory = { findByPublicId: async (id: string) => (config.agentBooking.publicId === id ? { restaurantId: RID, config } : null) }

beforeEach(() => {
  vi.clearAllMocks()
  config = { ...DEFAULT_BOOKING_CONFIG, mode: 'simple' }
  vi.mocked(agentBookingSettingsDeps).mockReturnValue({
    getConfig: async () => config,
    changeConfig: async (_rid, change) => {
      const next = change(structuredClone(config))
      if (next) config = next
      return next
    },
    settings: { getRestaurant: async () => ({ name: 'Cafe A', logoUrl: null, whatsappNumber: '+85230001111' }) },
    secrets: scriptedSecrets(),
    appUrl: 'https://app.ohmyclient.io',
  })
})

describe('agent booking settings routes (R43)', () => {
  it('staff → 403 on save, rotate and download; nothing changes', async () => {
    as('staff')
    expect((await put({ enabled: true, websiteHost: 'www.cafe-a.hk' })).status).toBe(403)
    expect((await ROTATE()).status).toBe(403)
    expect((await DOWNLOAD()).status).toBe(403)
    expect(config.agentBooking).toEqual(DEFAULT_BOOKING_CONFIG.agentBooking)
  })

  it('off by default; an admin enabling with a host mints a public id', async () => {
    as('admin')
    expect(config.agentBooking.enabled).toBe(false)
    const res = await put({ enabled: true, websiteHost: 'https://WWW.Cafe-A.hk/' })
    expect(res.status).toBe(200)
    const { agentBooking } = await res.json()
    expect(agentBooking).toEqual({ enabled: true, publicId: expect.stringMatching(/^[A-Za-z0-9_-]{22,64}$/), websiteHost: 'www.cafe-a.hk' })
    expect(config.agentBooking).toEqual(agentBooking)
  })

  it('enabling needs Simple booking and a valid host', async () => {
    as('admin')
    config = { ...config, mode: 'external' }
    expect((await (await put({ enabled: true, websiteHost: 'www.cafe-a.hk' })).json()).fields).toEqual({ mode: 'not_simple' })
    config = { ...config, mode: 'simple' }
    expect((await (await put({ enabled: true })).json()).fields).toEqual({ websiteHost: 'required' })
    for (const host of ['cafe-a.hk/path', 'http://cafe-a.hk', 'localhost', 'user@cafe-a.hk']) {
      const res = await put({ enabled: true, websiteHost: host })
      expect(res.status, host).toBe(400)
      expect((await res.json()).fields).toEqual({ websiteHost: 'invalid_host' })
    }
    expect((await put({ enabled: true, websiteHost: 'cafe-a.hk', extra: 1 })).status).toBe(400)
    expect(config.agentBooking.enabled).toBe(false)
  })

  it('rotating gives a new id; the old one stops resolving at once', async () => {
    as('admin')
    await put({ enabled: true, websiteHost: 'www.cafe-a.hk' })
    const oldId = config.agentBooking.publicId as string
    expect(await resolveAgentBookingTenant(directory, oldId)).not.toBeNull()
    const res = await ROTATE()
    expect(res.status).toBe(200)
    const newId = (await res.json()).agentBooking.publicId
    expect(newId).not.toBe(oldId)
    expect(await resolveAgentBookingTenant(directory, oldId)).toBeNull()
    expect(await resolveAgentBookingTenant(directory, newId)).not.toBeNull()
  })

  it('turning it off keeps the id and the API answers 404', async () => {
    as('admin')
    await put({ enabled: true, websiteHost: 'www.cafe-a.hk' })
    const id = config.agentBooking.publicId as string
    await put({ enabled: false })
    expect(config.agentBooking).toMatchObject({ enabled: false, publicId: id, websiteHost: 'www.cafe-a.hk' })
    expect(await resolveAgentBookingTenant(directory, id)).toBeNull()
  })

  it('download: 409 until enabled, then poppy.json as an attachment pointing at our OpenAPI URL', async () => {
    as('admin')
    expect((await DOWNLOAD()).status).toBe(409)
    await put({ enabled: true, websiteHost: 'www.cafe-a.hk' })
    const res = await DOWNLOAD()
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="poppy.json"')
    expect(res.headers.get('Content-Type')).toContain('application/json')
    expect(await res.json()).toEqual({
      protocol_version: '1.0',
      organization: { name: 'Cafe A', domain: 'www.cafe-a.hk' },
      apis: [{
        type: 'openapi',
        url: `https://app.ohmyclient.io/api/poppy/${config.agentBooking.publicId}/openapi.json`,
        description: expect.stringContaining('confirms the request on WhatsApp'),
      }],
    })
  })

  it('F7: download answers 409 not_enabled once booking mode is not Simple, even with agent booking on', async () => {
    as('admin')
    await put({ enabled: true, websiteHost: 'www.cafe-a.hk' })
    for (const mode of ['external', 'off'] as const) {
      config = { ...config, mode }
      const res = await DOWNLOAD()
      expect(res.status, mode).toBe(409)
      expect(await res.json()).toEqual({ error: 'not_enabled' })
    }
  })

  it('G2: without a usable WhatsApp number the download is 409 no_whatsapp_number (the agent API would 404 every POST)', async () => {
    as('admin')
    await put({ enabled: true, websiteHost: 'www.cafe-a.hk' })
    const deps = vi.mocked(agentBookingSettingsDeps)()
    for (const whatsappNumber of [null, '', 'not-a-number']) {
      vi.mocked(agentBookingSettingsDeps).mockReturnValue({
        ...deps,
        settings: { getRestaurant: async () => ({ name: 'Cafe A', logoUrl: null, whatsappNumber }) },
      })
      const res = await DOWNLOAD()
      expect(res.status, String(whatsappNumber)).toBe(409)
      expect(await res.json()).toEqual({ error: 'no_whatsapp_number' })
    }
    vi.mocked(agentBookingSettingsDeps).mockReturnValue({ ...deps, settings: { getRestaurant: async () => null } })
    expect(await (await DOWNLOAD()).json()).toEqual({ error: 'no_whatsapp_number' })
  })

  it('F6: without a usable NEXT_PUBLIC_APP_URL the download is 500 server_error, logged by error name only', async () => {
    as('admin')
    await put({ enabled: true, websiteHost: 'www.cafe-a.hk' })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(agentBookingSettingsDeps).mockReturnValue({ ...vi.mocked(agentBookingSettingsDeps)(), appUrl: null })
    const res = await DOWNLOAD()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'server_error' })
    expect(errors.mock.calls).toEqual([[expect.any(String), 'AgentAppUrlError']])
    errors.mockRestore()
  })

  it('the main booking settings save never touches agentBooking', async () => {
    const { applyBookingSettings } = await import('@/domain/value-objects/booking-config')
    as('admin')
    await put({ enabled: true, websiteHost: 'www.cafe-a.hk' })
    const saved = applyBookingSettings(config, { ...DEFAULT_BOOKING_CONFIG, mode: 'simple', maxPartySize: 8 })
    expect(saved.agentBooking).toEqual(config.agentBooking)
  })
})
