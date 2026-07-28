import { describe, it, expect } from 'vitest'
import {
  classifyWebhookKind,
  extractQualityEvent,
  normalizeStatusPayload,
} from '../webhooks'

describe('classifyWebhookKind', () => {
  it('classifies Meta envelope with statuses[] as status', () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  { id: 'wamid.X', status: 'delivered' },
                ],
              },
            },
          ],
        },
      ],
    }
    expect(classifyWebhookKind(body)).toBe('status')
  })

  it('classifies Meta envelope with messages[] as inbound', () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { id: 'wamid.M', from: '+85291234567', type: 'text' },
                ],
              },
            },
          ],
        },
      ],
    }
    expect(classifyWebhookKind(body)).toBe('inbound')
  })

  it('classifies Kapso flat payload with message_status as status', () => {
    const body = {
      message_status: { id: 'wamid.X', status: 'sent' },
      conversation: { phone_number_id: 'pn-1' },
    }
    expect(classifyWebhookKind(body)).toBe('status')
  })

  it("classifies Kapso flat payload with event='message_status' as status", () => {
    const body = {
      event: 'message_status',
      data: { id: 'wamid.X', status: 'read' },
    }
    expect(classifyWebhookKind(body)).toBe('status')
  })

  it('classifies Kapso flat payload with .message as inbound', () => {
    const body = {
      message: { id: 'wamid.M', from: '+85291234567', type: 'text' },
    }
    expect(classifyWebhookKind(body)).toBe('inbound')
  })

  it('returns "other" for garbage payloads', () => {
    expect(classifyWebhookKind(null)).toBe('other')
    expect(classifyWebhookKind(undefined)).toBe('other')
    expect(classifyWebhookKind({})).toBe('other')
    expect(classifyWebhookKind({ foo: 'bar' })).toBe('other')
  })

  it('does not misclassify a Meta envelope without statuses or messages', () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: { metadata: { phone_number_id: 'pn-1' } } }] }],
    }
    expect(classifyWebhookKind(body)).toBe('other')
  })
})

describe('classifyWebhookKind — template status (TPL-009)', () => {
  it("classifies a message_template_status_update payload as template_status", () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA-1',
          changes: [
            {
              field: 'message_template_status_update',
              value: {
                event: 'APPROVED',
                message_template_id: 1029650636326514,
                message_template_name: 'offer_promotion',
                message_template_language: 'zh_HK',
              },
            },
          ],
        },
      ],
    }
    expect(classifyWebhookKind(body)).toBe('template_status')
  })

  it('classifies a mixed statuses+template payload as status (precedence)', () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA-1',
          changes: [
            { value: { statuses: [{ id: 'wamid.X', status: 'delivered' }] } },
            {
              field: 'message_template_status_update',
              value: { event: 'APPROVED' },
            },
          ],
        },
      ],
    }
    expect(classifyWebhookKind(body)).toBe('status')
  })
})

describe('normalizeStatusPayload', () => {
  it('extracts statuses from a Meta envelope via the Kapso SDK', () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  {
                    id: 'wamid.AAA',
                    status: 'delivered',
                    timestamp: '1731657600',
                    recipient_id: '85291234567',
                  },
                ],
              },
            },
          ],
        },
      ],
    }
    const out = normalizeStatusPayload(body)
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('wamid.AAA')
    expect(out[0].status).toBe('delivered')
  })

  it('extracts a single status from a Kapso flat message_status payload', () => {
    const body = {
      message_status: {
        id: 'wamid.BBB',
        status: 'read',
        timestamp: '2026-05-04T10:00:03Z',
        recipient_id: '85291234567',
      },
    }
    const out = normalizeStatusPayload(body)
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('wamid.BBB')
    expect(out[0].status).toBe('read')
  })

  it("extracts status from Kapso flat event='message_status' shape", () => {
    const body = {
      event: 'message_status',
      data: {
        id: 'wamid.CCC',
        status: 'failed',
        errors: [{ code: 131049, title: 'PMM' }],
      },
    }
    const out = normalizeStatusPayload(body)
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('wamid.CCC')
    expect(out[0].status).toBe('failed')
  })

  it('returns [] for inbound or other payloads', () => {
    expect(normalizeStatusPayload(null)).toEqual([])
    expect(normalizeStatusPayload({ message: { id: 'm' } })).toEqual([])
  })

  it('skips status entries without an id', () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  { status: 'delivered' }, // no id
                  { id: 'wamid.D', status: 'sent' },
                ],
              },
            },
          ],
        },
      ],
    }
    const out = normalizeStatusPayload(body)
    expect(out.map((s) => s.id)).toEqual(['wamid.D'])
  })
})

describe('classifyWebhookKind — quality (WAQ-006)', () => {
  it("classifies field='account_update' with quality field as quality", () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA-1',
          changes: [
            {
              field: 'account_update',
              value: {
                event: 'account_quality_update',
                phone_number: '85291234567',
                phone_number_id: 'pn-1',
                current_limit: 'TIER_1K',
                old_limit: 'TIER_NOT_SET',
              },
            },
          ],
        },
      ],
    }
    expect(classifyWebhookKind(body)).toBe('quality')
  })

  it("classifies field='message_template_quality_update' as quality", () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'message_template_quality_update',
              value: {
                previous_quality_score: 'GREEN',
                new_quality_score: 'YELLOW',
              },
            },
          ],
        },
      ],
    }
    expect(classifyWebhookKind(body)).toBe('quality')
  })

  it("classifies field='phone_number_quality_update' as quality", () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'phone_number_quality_update',
              value: {
                display_phone_number: '85291234567',
                event: 'FLAGGED',
                current_limit: 'TIER_1K',
              },
            },
          ],
        },
      ],
    }
    expect(classifyWebhookKind(body)).toBe('quality')
  })

  it('classifies a Kapso flat account_quality_update payload as quality', () => {
    const body = {
      event: 'account_quality_update',
      data: {
        phone_number_id: 'pn-1',
        current_limit: 'TIER_10K',
        quality: 'green',
      },
    }
    expect(classifyWebhookKind(body)).toBe('quality')
  })

  it('does not regress existing classifications (status, inbound, other)', () => {
    expect(
      classifyWebhookKind({
        entry: [{ changes: [{ value: { statuses: [{ id: 'x', status: 's' }] } }] }],
      })
    ).toBe('status')
    expect(
      classifyWebhookKind({
        entry: [{ changes: [{ value: { messages: [{ id: 'x', from: 'y', type: 'text' }] } }] }],
      })
    ).toBe('inbound')
    expect(classifyWebhookKind({ foo: 'bar' })).toBe('other')
  })
})

describe('extractQualityEvent', () => {
  it("reads account_update event with phone_number_id, tier (current_limit), and lowercase quality", () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA-1',
          changes: [
            {
              field: 'account_update',
              value: {
                event: 'account_quality_update',
                phone_number_id: 'pn-1',
                current_limit: 'TIER_1K',
                quality: 'yellow',
              },
            },
          ],
        },
      ],
    }
    const out = extractQualityEvent(body)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      phoneNumberId: 'pn-1',
      qualityRating: 'YELLOW',
      messagingTier: 'TIER_1K',
      flagged: false,
    })
    expect(out[0].raw).toBeDefined()
  })

  it('reads phone_number_quality_update with FLAGGED event', () => {
    const body = {
      entry: [
        {
          changes: [
            {
              field: 'phone_number_quality_update',
              value: {
                display_phone_number: '85291234567',
                event: 'FLAGGED',
                current_limit: 'TIER_1K',
              },
            },
          ],
        },
      ],
    }
    const out = extractQualityEvent(body)
    expect(out).toHaveLength(1)
    expect(out[0].flagged).toBe(true)
    // No quality field provided -> UNKNOWN sentinel rather than guessing.
    expect(out[0].qualityRating).toBe('UNKNOWN')
    // phone_number_quality_update ships ONLY display_phone_number
    expect(out[0].phoneNumberId).toBeNull()
    expect(out[0].displayPhoneNumber).toBe('85291234567')
  })

  it('reads message_template_quality_update new_quality_score', () => {
    const body = {
      entry: [
        {
          changes: [
            {
              field: 'message_template_quality_update',
              value: {
                previous_quality_score: 'GREEN',
                new_quality_score: 'RED',
              },
            },
          ],
        },
      ],
    }
    const out = extractQualityEvent(body)
    expect(out).toHaveLength(1)
    expect(out[0].qualityRating).toBe('RED')
  })

  it('reads Kapso flat account_quality_update payload', () => {
    const body = {
      event: 'account_quality_update',
      data: {
        phone_number_id: 'pn-9',
        current_limit: 'TIER_100K',
        quality: 'GREEN',
      },
    }
    const out = extractQualityEvent(body)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      phoneNumberId: 'pn-9',
      qualityRating: 'GREEN',
      messagingTier: 'TIER_100K',
    })
  })

  it('returns [] for unrelated payloads', () => {
    expect(extractQualityEvent(null)).toEqual([])
    expect(extractQualityEvent({})).toEqual([])
    expect(
      extractQualityEvent({
        entry: [{ changes: [{ value: { statuses: [{ id: 'x', status: 's' }] } }] }],
      })
    ).toEqual([])
  })

  it('iterates ALL entry[].changes[] (batched payloads)', () => {
    // Meta batches multiple changes per webhook. Pre-fix the helper only
    // inspected entry[0].changes[0] and silently dropped the rest.
    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA-1',
          changes: [
            {
              field: 'message_template_quality_update',
              value: { new_quality_score: 'GREEN' },
            },
            {
              field: 'message_template_quality_update',
              value: { new_quality_score: 'YELLOW' },
            },
          ],
        },
        {
          id: 'WABA-1',
          changes: [
            {
              field: 'account_update',
              value: {
                event: 'account_quality_update',
                phone_number_id: 'pn-1',
                quality: 'red',
                current_limit: 'TIER_1K',
              },
            },
            {
              field: 'phone_number_quality_update',
              value: {
                display_phone_number: '85291234567',
                event: 'FLAGGED',
                current_limit: 'TIER_1K',
              },
            },
          ],
        },
      ],
    }
    const out = extractQualityEvent(body)
    expect(out).toHaveLength(4)
    expect(out.map((e) => e.qualityRating)).toEqual([
      'GREEN',
      'YELLOW',
      'RED',
      'UNKNOWN',
    ])
  })

  it('skips non-quality changes interleaved with quality ones', () => {
    const body = {
      entry: [
        {
          changes: [
            { field: 'messages', value: { messages: [{ id: 'x' }] } },
            {
              field: 'account_update',
              value: { quality: 'green' },
            },
          ],
        },
      ],
    }
    const out = extractQualityEvent(body)
    expect(out).toHaveLength(1)
    expect(out[0].qualityRating).toBe('GREEN')
  })

  it('coerces unknown quality strings to UNKNOWN (defensive)', () => {
    const body = {
      entry: [
        {
          changes: [
            {
              field: 'account_update',
              value: { quality: 'PURPLE' },
            },
          ],
        },
      ],
    }
    const out = extractQualityEvent(body)
    expect(out[0].qualityRating).toBe('UNKNOWN')
  })

  // WAQ-009 round-1 review (CRITICAL): the stale-event guard MUST use Meta's
  // payload event time, not server `now`. extractQualityEvent must surface
  // it via QualityWebhookEntry.eventTimestamp.
  describe('eventTimestamp (WAQ-009 r1)', () => {
    it('reads top-level entry[].time (seconds since epoch) as ISO', () => {
      const body = {
        entry: [
          {
            id: 'WABA-1',
            time: 1777896000, // 2026-05-04T12:00:00.000Z
            changes: [
              {
                field: 'account_update',
                value: {
                  event: 'account_quality_update',
                  phone_number_id: 'pn-1',
                  quality: 'green',
                },
              },
            ],
          },
        ],
      }
      const out = extractQualityEvent(body)
      expect(out[0].eventTimestamp).toBe('2026-05-04T12:00:00.000Z')
    })

    it('falls back to value.event_time when entry[].time is missing', () => {
      const body = {
        entry: [
          {
            changes: [
              {
                field: 'phone_number_quality_update',
                value: {
                  display_phone_number: '85291234567',
                  event: 'FLAGGED',
                  event_time: 1777896000,
                },
              },
            ],
          },
        ],
      }
      const out = extractQualityEvent(body)
      expect(out[0].eventTimestamp).toBe('2026-05-04T12:00:00.000Z')
    })

    it('falls back to value.timestamp (Kapso flat shape, ISO string)', () => {
      const body = {
        event: 'account_quality_update',
        data: {
          phone_number_id: 'pn-9',
          quality: 'GREEN',
          timestamp: '2026-05-04T12:00:00.000Z',
        },
      }
      const out = extractQualityEvent(body)
      expect(out[0].eventTimestamp).toBe('2026-05-04T12:00:00.000Z')
    })

    it('returns undefined when no payload timestamp is present', () => {
      const body = {
        entry: [
          {
            changes: [
              {
                field: 'account_update',
                value: { quality: 'green', phone_number_id: 'pn-1' },
              },
            ],
          },
        ],
      }
      const out = extractQualityEvent(body)
      expect(out[0].eventTimestamp).toBeUndefined()
    })

    it('prefers entry[].time over value.event_time / value.timestamp', () => {
      const body = {
        entry: [
          {
            time: 1777896000, // wins
            changes: [
              {
                field: 'account_update',
                value: {
                  event: 'account_quality_update',
                  phone_number_id: 'pn-1',
                  quality: 'green',
                  event_time: 1, // would parse to 1970 if used
                  timestamp: '2099-01-01T00:00:00.000Z',
                },
              },
            ],
          },
        ],
      }
      const out = extractQualityEvent(body)
      expect(out[0].eventTimestamp).toBe('2026-05-04T12:00:00.000Z')
    })
  })
})
