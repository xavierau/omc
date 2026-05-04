import { describe, it, expect } from 'vitest'
import { classifyWebhookKind, normalizeStatusPayload } from '../webhooks'

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
