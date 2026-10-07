import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/integration-outbound-member-repository', () => ({
  findMemberForOutboundPayload: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/consent-record-repository', () => ({
  findLatestConsentByCategory: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/integration-member-ref-repository', () => ({
  findExternalRefForMember: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/integration-event-repository', () => ({
  findEarliestMemberCreatedSource: vi.fn(),
}))

import { findMemberForOutboundPayload } from '@/infrastructure/supabase/repositories/integration-outbound-member-repository'
import { findLatestConsentByCategory } from '@/infrastructure/supabase/repositories/consent-record-repository'
import { findExternalRefForMember } from '@/infrastructure/supabase/repositories/integration-member-ref-repository'
import { findEarliestMemberCreatedSource } from '@/infrastructure/supabase/repositories/integration-event-repository'
import { ConsentRecord } from '@/domain/entities/consent-record'
import type { IntegrationEvent } from '@/domain/entities/integration-event'
import { buildOutboundPayload } from '../build-outbound-payload'
import type { MemberCreatedEvent, MemberUpdatedEvent } from '@/application/dtos/integration-member-api'

function member(overrides: Partial<Awaited<ReturnType<typeof findMemberForOutboundPayload>>> = {}) {
  return {
    id: 'm-1',
    restaurantId: 'r-1',
    phone: '+85298765432',
    name: 'Ada',
    status: 'active' as const,
    preferredLanguage: 'en' as const,
    joinedAt: '2026-09-10T00:00:00.000Z',
    ...overrides,
  }
}

function consent(category: 'utility' | 'marketing', status: 'opted_in' | 'opted_out' | 'pending', grade: 'strong' | 'weak' | 'medium' | 'none' = 'strong') {
  return ConsentRecord.fromProps({
    id: `cr-${category}`,
    restaurantId: 'r-1',
    memberId: 'm-1',
    phoneE164: '+85298765432',
    category,
    status,
    consentGrade: grade,
    source: 'partner_api',
    sourceReference: null,
    businessNameShown: null,
    capturedAt: '2026-09-10T00:00:00.000Z',
    revokedAt: null,
    capturedIp: null,
    capturedUserAgent: null,
    proofUrl: null,
    consentTextShown: null,
    expiresAt: null,
    grantedAt: null,
    importBatchId: null,
  })
}

const createdEvent: IntegrationEvent = {
  id: 'evt_1',
  restaurantId: 'r-1',
  memberId: 'm-1',
  type: 'member.created',
  changed: [],
  originIntegrationId: 'int-1',
  occurredAt: '2026-09-10T00:00:05.000Z',
  source: 'partner_api',
}

describe('buildOutboundPayload -- member.created', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(findExternalRefForMember).mockResolvedValue(null)
  })

  it('builds the full wire envelope + data shape from live Postgres reads', async () => {
    vi.mocked(findMemberForOutboundPayload).mockResolvedValue(member())
    vi.mocked(findLatestConsentByCategory).mockImplementation(async ({ category }) =>
      category === 'utility' ? consent('utility', 'opted_in') : consent('marketing', 'opted_in')
    )

    const result = await buildOutboundPayload(createdEvent, 'r-1', 'int-1')

    expect(result.ok).toBe(true)
    const payload = (result as { ok: true; payload: MemberCreatedEvent }).payload
    expect(payload).toMatchObject({
      id: 'evt_1',
      type: 'member.created',
      api_version: '2026-09-01',
      restaurant_id: 'r-1',
      integration_id: 'int-1',
      origin_integration_id: 'int-1',
      data: {
        member_id: 'm-1',
        phone_e164: '+85298765432',
        name: 'Ada',
        language: 'en',
        source: 'partner_api',
        external_ref: null,
        consent: { effective_level: 'all', utility: 'opted_in', marketing: 'opted_in', grade: 'strong' },
      },
    })
    expect((result as { ok: true; body: string }).body).toBe(JSON.stringify(payload))
  })

  it('T-H7: re-reads live state on every call -- a rename between enqueue and attempt is reflected, never stale', async () => {
    vi.mocked(findMemberForOutboundPayload).mockResolvedValue(member({ name: 'Renamed After Enqueue' }))
    vi.mocked(findLatestConsentByCategory).mockResolvedValue(null)

    const result = await buildOutboundPayload(createdEvent, 'r-1', 'int-1')

    expect((result as { ok: true; payload: MemberCreatedEvent }).payload.data.name).toBe('Renamed After Enqueue')
  })

  it('no consent rows for either category -> both none, effective_level none, grade null', async () => {
    vi.mocked(findMemberForOutboundPayload).mockResolvedValue(member())
    vi.mocked(findLatestConsentByCategory).mockResolvedValue(null)

    const result = await buildOutboundPayload(createdEvent, 'r-1', 'int-1')

    expect((result as { ok: true; payload: MemberCreatedEvent }).payload.data.consent).toEqual({
      effective_level: 'none',
      utility: 'none',
      marketing: 'none',
      grade: null,
    })
  })

  it('zh_hk preferred_language maps to the zh-HK wire code', async () => {
    vi.mocked(findMemberForOutboundPayload).mockResolvedValue(member({ preferredLanguage: 'zh_hk' }))
    vi.mocked(findLatestConsentByCategory).mockResolvedValue(null)

    const result = await buildOutboundPayload(createdEvent, 'r-1', 'int-1')
    expect((result as { ok: true; payload: MemberCreatedEvent }).payload.data.language).toBe('zh-HK')
  })

  it('member not found (deleted between enqueue and attempt) -> a structured error, not a throw', async () => {
    vi.mocked(findMemberForOutboundPayload).mockResolvedValue(null)

    const result = await buildOutboundPayload(createdEvent, 'r-1', 'int-1')
    expect(result).toEqual({ ok: false, error: { title: 'member_not_found', details: 'm-1' } })
  })
})

describe('buildOutboundPayload -- source resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(findMemberForOutboundPayload).mockResolvedValue(member())
    vi.mocked(findLatestConsentByCategory).mockResolvedValue(null)
    vi.mocked(findExternalRefForMember).mockResolvedValue(null)
  })

  it('uses the event`s own source when it is a valid wire value', async () => {
    const result = await buildOutboundPayload({ ...createdEvent, source: 'web' }, 'r-1', 'int-1')
    expect((result as { ok: true; payload: MemberCreatedEvent }).payload.data.source).toBe('web')
  })

  it('member.updated with a null event.source falls back to the member`s own member.created source', async () => {
    vi.mocked(findEarliestMemberCreatedSource).mockResolvedValue('csv_import')
    const updatedEvent: IntegrationEvent = { ...createdEvent, type: 'member.updated', source: null, changed: ['status'] }

    const result = await buildOutboundPayload(updatedEvent, 'r-1', 'int-1')

    expect((result as { ok: true; payload: MemberUpdatedEvent }).payload.data.source).toBe('csv_import')
    expect(findEarliestMemberCreatedSource).toHaveBeenCalledWith('m-1')
  })

  it('falls back to the documented default when no source is known anywhere (pre-outbox member)', async () => {
    vi.mocked(findEarliestMemberCreatedSource).mockResolvedValue(null)
    const updatedEvent: IntegrationEvent = { ...createdEvent, type: 'member.updated', source: null, changed: ['status'] }

    const result = await buildOutboundPayload(updatedEvent, 'r-1', 'int-1')
    expect((result as { ok: true; payload: MemberUpdatedEvent }).payload.data.source).toBe('whatsapp')
  })

  it('rejects a non-enum event.source rather than leaking it onto the wire', async () => {
    const result = await buildOutboundPayload({ ...createdEvent, source: 'whatsapp_join_keyword' }, 'r-1', 'int-1')
    // Falls through to the member.created lookup (since it's the same event), which
    // is itself the member.created row -- but its own source isn't a valid enum
    // value either, so it resolves to the documented fallback.
    expect((result as { ok: true; payload: MemberCreatedEvent }).payload.data.source).toBe('whatsapp')
  })
})

describe('buildOutboundPayload -- member.updated', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(findExternalRefForMember).mockResolvedValue(null)
    vi.mocked(findLatestConsentByCategory).mockResolvedValue(null)
  })

  it('adds changed[] and status to the same data shape as member.created', async () => {
    vi.mocked(findMemberForOutboundPayload).mockResolvedValue(member({ status: 'unsubscribed' }))
    const updatedEvent: IntegrationEvent = {
      ...createdEvent,
      type: 'member.updated',
      changed: ['status', 'consent'],
      source: 'partner_api',
    }

    const result = await buildOutboundPayload(updatedEvent, 'r-1', 'int-1')
    const payload = (result as { ok: true; payload: MemberUpdatedEvent }).payload
    expect(payload.type).toBe('member.updated')
    expect(payload.data.changed).toEqual(['status', 'consent'])
    expect(payload.data.status).toBe('unsubscribed')
  })
})

describe('buildOutboundPayload -- ping', () => {
  beforeEach(() => vi.clearAllMocks())

  it('carries no member data at all (US-9: ping payload has no PII)', async () => {
    const pingEvent: IntegrationEvent = {
      id: 'evt_ping',
      restaurantId: 'r-1',
      memberId: null,
      type: 'ping',
      changed: [],
      originIntegrationId: null,
      occurredAt: '2026-09-10T00:00:05.000Z',
      source: null,
    }

    const result = await buildOutboundPayload(pingEvent, 'r-1', 'int-1')

    expect(result).toEqual({
      ok: true,
      payload: {
        id: 'evt_ping',
        type: 'ping',
        occurred_at: '2026-09-10T00:00:05.000Z',
        api_version: '2026-09-01',
        restaurant_id: 'r-1',
        integration_id: 'int-1',
        origin_integration_id: null,
        data: {},
      },
      body: expect.any(String),
    })
    expect(findMemberForOutboundPayload).not.toHaveBeenCalled()
  })
})
