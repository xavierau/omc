import { describe, it, expect } from 'vitest'
import {
  extractTemplateStatusEvents,
  extractTemplateStatusWabaId,
} from '../webhooks-template-status'

// Kushiro fixture (TPL-009 / issue #93): tenant 釧 Kushiro's `offer_promotion`
// template stuck `pending` because nothing ever consumed this event.
const WABA_ID = '1671944700578218'
const META_TEMPLATE_ID_NUM = 1029650636326514

function metaEnvelope(changes: Array<Record<string, unknown>>, entryOverrides: Record<string, unknown> = {}) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: WABA_ID,
        time: 1777896000, // 2026-05-04T12:00:00.000Z
        changes,
        ...entryOverrides,
      },
    ],
  }
}

function statusChange(value: Record<string, unknown>) {
  return { field: 'message_template_status_update', value }
}

describe('extractTemplateStatusEvents', () => {
  it('reads a Meta envelope APPROVED event (Kushiro shape)', () => {
    const body = metaEnvelope([
      statusChange({
        event: 'APPROVED',
        message_template_id: META_TEMPLATE_ID_NUM,
        message_template_name: 'offer_promotion',
        message_template_language: 'zh_HK',
        reason: 'NONE',
      }),
    ])
    const out = extractTemplateStatusEvents(body)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      wabaId: WABA_ID,
      metaTemplateId: '1029650636326514', // numeric -> string
      templateName: 'offer_promotion',
      language: 'zh_HK',
      event: 'APPROVED',
      reason: null, // "NONE" normalises to null
    })
    expect(out[0].raw).toBeDefined()
  })

  it('iterates ALL entry[].changes[] (batched payloads) — none dropped', () => {
    const body = metaEnvelope([
      statusChange({
        event: 'APPROVED',
        message_template_id: META_TEMPLATE_ID_NUM,
        message_template_name: 'offer_promotion',
        message_template_language: 'zh_HK',
      }),
      statusChange({
        event: 'REJECTED',
        message_template_id: 999,
        message_template_name: 'other_template',
        message_template_language: 'en',
        reason: 'Template contains prohibited content',
      }),
    ])
    const out = extractTemplateStatusEvents(body)
    expect(out).toHaveLength(2)
    expect(out.map((e) => e.event)).toEqual(['APPROVED', 'REJECTED'])
    expect(out[1].reason).toBe('Template contains prohibited content')
  })

  it('keeps the entry with metaTemplateId: null when message_template_id is missing', () => {
    const body = metaEnvelope([
      statusChange({
        event: 'PAUSED',
        message_template_name: 'offer_promotion',
        message_template_language: 'zh_HK',
      }),
    ])
    const out = extractTemplateStatusEvents(body)
    expect(out).toHaveLength(1)
    expect(out[0].metaTemplateId).toBeNull()
    expect(out[0].templateName).toBe('offer_promotion')
    expect(out[0].language).toBe('zh_HK')
  })

  it('still returns the entry when both id and name are missing (handler decides)', () => {
    const body = metaEnvelope([
      statusChange({
        event: 'DISABLED',
        message_template_language: 'en',
      }),
    ])
    const out = extractTemplateStatusEvents(body)
    expect(out).toHaveLength(1)
    expect(out[0].metaTemplateId).toBeNull()
    expect(out[0].templateName).toBeNull()
  })

  it('reads wabaId from entry[].id and eventTimestamp from entry[].time', () => {
    const body = metaEnvelope([
      statusChange({
        event: 'APPROVED',
        message_template_id: META_TEMPLATE_ID_NUM,
      }),
    ])
    const out = extractTemplateStatusEvents(body)
    expect(out[0].wabaId).toBe(WABA_ID)
    expect(out[0].eventTimestamp).toBe('2026-05-04T12:00:00.000Z')
  })

  it("normalises reason: 'NONE' to null but preserves a real reason", () => {
    const approved = metaEnvelope([
      statusChange({ event: 'APPROVED', reason: 'NONE' }),
    ])
    const rejected = metaEnvelope([
      statusChange({ event: 'REJECTED', reason: 'Incorrect category' }),
    ])
    expect(extractTemplateStatusEvents(approved)[0].reason).toBeNull()
    expect(extractTemplateStatusEvents(rejected)[0].reason).toBe(
      'Incorrect category'
    )
  })

  it('reads a Kapso-flat payload with event + data', () => {
    const body = {
      event: 'message_template_status_update',
      data: {
        message_template_id: META_TEMPLATE_ID_NUM,
        message_template_name: 'offer_promotion',
        message_template_language: 'zh_HK',
        event: 'APPROVED',
        reason: 'NONE',
      },
    }
    const out = extractTemplateStatusEvents(body)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      metaTemplateId: '1029650636326514',
      templateName: 'offer_promotion',
      language: 'zh_HK',
      event: 'APPROVED',
      reason: null,
    })
  })

  it('reads a Kapso-flat top-level-fields variant (no nested data; field+event, not event+data)', () => {
    // Judgement call (unverified shape, plan Risks #2): the discriminator
    // uses Meta's own `field` key so it doesn't collide with the actual
    // per-template `event` value (APPROVED/REJECTED/...).
    const body = {
      field: 'message_template_status_update',
      event: 'REJECTED',
      message_template_id: META_TEMPLATE_ID_NUM,
      message_template_name: 'offer_promotion',
      message_template_language: 'zh_HK',
      reason: 'Bad grammar',
    }
    const out = extractTemplateStatusEvents(body)
    expect(out).toHaveLength(1)
    expect(out[0].metaTemplateId).toBe('1029650636326514')
    expect(out[0].event).toBe('REJECTED')
    expect(out[0].reason).toBe('Bad grammar')
  })

  it('returns [] for malformed/empty payloads', () => {
    expect(extractTemplateStatusEvents(null)).toEqual([])
    expect(extractTemplateStatusEvents(undefined)).toEqual([])
    expect(extractTemplateStatusEvents({})).toEqual([])
    expect(extractTemplateStatusEvents({ foo: 'bar' })).toEqual([])
    expect(
      extractTemplateStatusEvents({ object: 'whatsapp_business_account', entry: [] })
    ).toEqual([])
  })

  it('returns [] for unrelated payloads (status/quality/inbound)', () => {
    expect(
      extractTemplateStatusEvents({
        entry: [{ changes: [{ value: { statuses: [{ id: 'x', status: 's' }] } }] }],
      })
    ).toEqual([])
    expect(
      extractTemplateStatusEvents({
        entry: [{ changes: [{ field: 'account_update', value: { quality: 'green' } }] }],
      })
    ).toEqual([])
    expect(
      extractTemplateStatusEvents({ message: { id: 'wamid.M' } })
    ).toEqual([])
  })
})

describe('extractTemplateStatusWabaId', () => {
  it('returns the WABA id for a Meta template-status envelope', () => {
    const body = metaEnvelope([statusChange({ event: 'APPROVED' })])
    expect(extractTemplateStatusWabaId(body)).toBe(WABA_ID)
  })

  it('returns the WABA id for a Kapso-flat template-status payload (defensive keys)', () => {
    const body = {
      event: 'message_template_status_update',
      data: {
        waba_id: WABA_ID,
        event: 'APPROVED',
        message_template_id: META_TEMPLATE_ID_NUM,
      },
    }
    expect(extractTemplateStatusWabaId(body)).toBe(WABA_ID)
  })

  it('returns the WABA id via whatsapp_business_account_id (defensive key)', () => {
    const body = {
      event: 'message_template_status_update',
      data: {
        whatsapp_business_account_id: WABA_ID,
        event: 'APPROVED',
      },
    }
    expect(extractTemplateStatusWabaId(body)).toBe(WABA_ID)
  })

  it('returns null for inbound, status, and quality payloads (shape-gated)', () => {
    expect(
      extractTemplateStatusWabaId({
        entry: [{ id: WABA_ID, changes: [{ value: { statuses: [{ id: 'x', status: 's' }] } }] }],
      })
    ).toBeNull()
    expect(
      extractTemplateStatusWabaId({
        entry: [{ id: WABA_ID, changes: [{ value: { messages: [{ id: 'x', from: 'y', type: 'text' }] } }] }],
      })
    ).toBeNull()
    expect(
      extractTemplateStatusWabaId({
        entry: [
          {
            id: WABA_ID,
            changes: [{ field: 'account_update', value: { quality: 'green' } }],
          },
        ],
      })
    ).toBeNull()
  })

  it('returns null for malformed/empty payloads', () => {
    expect(extractTemplateStatusWabaId(null)).toBeNull()
    expect(extractTemplateStatusWabaId({})).toBeNull()
  })
})
