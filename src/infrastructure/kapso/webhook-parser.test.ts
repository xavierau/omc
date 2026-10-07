import crypto from 'crypto'
import { describe, it, expect } from 'vitest'
import { parseKapsoWebhook, verifyKapsoSignature } from './webhook-parser'

describe('parseKapsoWebhook', () => {
  describe('Kapso format', () => {
    it('extracts contactName from conversation.contact_name', () => {
      const payload = {
        message: {
          from: '85266281556',
          id: 'wamid.xxx',
          type: 'text',
          text: { body: 'JOIN' },
          timestamp: '1774685162',
        },
        conversation: {
          id: 'conv-123',
          contact_name: 'Xavier',
          phone_number_id: '940526715812638',
        },
      }

      const result = parseKapsoWebhook(payload)

      expect(result).not.toBeNull()
      expect(result!.contactName).toBe('Xavier')
    })

    it('returns undefined contactName when conversation has no contact_name', () => {
      const payload = {
        message: {
          from: '85266281556',
          id: 'wamid.xxx',
          type: 'text',
          text: { body: 'JOIN' },
          timestamp: '1774685162',
        },
      }

      const result = parseKapsoWebhook(payload)

      expect(result).not.toBeNull()
      expect(result!.contactName).toBeUndefined()
    })
  })

  describe('Meta format', () => {
    it('extracts contactName from contacts profile name', () => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                value: {
                  contacts: [{ profile: { name: 'Jane' } }],
                  messages: [
                    {
                      from: '15551234567',
                      id: 'wamid.yyy',
                      type: 'text',
                      text: { body: 'Hello' },
                      timestamp: '1774685162',
                    },
                  ],
                },
              },
            ],
          },
        ],
      }

      const result = parseKapsoWebhook(payload)

      expect(result).not.toBeNull()
      expect(result!.contactName).toBe('Jane')
    })

    it('returns undefined contactName when contacts is missing', () => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: '15551234567',
                      id: 'wamid.yyy',
                      type: 'text',
                      text: { body: 'Hello' },
                      timestamp: '1774685162',
                    },
                  ],
                },
              },
            ],
          },
        ],
      }

      const result = parseKapsoWebhook(payload)

      expect(result).not.toBeNull()
      expect(result!.contactName).toBeUndefined()
    })
  })

  describe('Kapso format - image message', () => {
    it('parses image type with url and id', () => {
      const payload = {
        message: {
          from: '85266281556',
          id: 'wamid.img',
          type: 'image',
          image: { url: 'https://example.com/img.jpg', id: 'img-1' },
          timestamp: '1774685162',
        },
      }

      const result = parseKapsoWebhook(payload)

      expect(result).not.toBeNull()
      expect(result!.type).toBe('image')
      expect(result!.imageUrl).toBe('https://example.com/img.jpg')
      expect(result!.imageId).toBe('img-1')
    })
  })

  describe('Kapso format - interactive messages', () => {
    it('extracts text from button_reply', () => {
      const payload = {
        message: {
          from: '85266281556',
          id: 'wamid.btn',
          type: 'interactive',
          interactive: { button_reply: { id: 'btn-1' } },
          timestamp: '1774685162',
        },
      }

      const result = parseKapsoWebhook(payload)

      expect(result).not.toBeNull()
      expect(result!.type).toBe('interactive')
      expect(result!.text).toBe('btn-1')
    })

    it('extracts text from list_reply', () => {
      const payload = {
        message: {
          from: '85266281556',
          id: 'wamid.list',
          type: 'interactive',
          interactive: { list_reply: { id: 'list-1' } },
          timestamp: '1774685162',
        },
      }

      const result = parseKapsoWebhook(payload)

      expect(result).not.toBeNull()
      expect(result!.type).toBe('interactive')
      expect(result!.text).toBe('list-1')
    })

    // Regression (code review H1): a stray `kapso.flow_response` on a
    // non-flow interactive message must NOT hijack the message into the
    // flow-submission path. Only an `nfm_reply` signal on `interactive`
    // may populate `flowResponse` — see `hasNfmReplySignal` in
    // webhook-parser.ts.
    it('button_reply with a stray kapso.flow_response:{} still routes as a button reply, flowResponse undefined', () => {
      const payload = {
        message: {
          from: '85266281556',
          id: 'wamid.btn-kapso',
          type: 'interactive',
          interactive: { button_reply: { id: 'btn-1' } },
          kapso: { flow_response: {} },
          timestamp: '1774685162',
        },
      }

      const result = parseKapsoWebhook(payload)

      expect(result).not.toBeNull()
      expect(result!.type).toBe('interactive')
      expect(result!.text).toBe('btn-1')
      expect(result!.flowResponse).toBeUndefined()
    })

    it('list_reply with a stray kapso.flow_response:{} still routes as a list reply, flowResponse undefined', () => {
      const payload = {
        message: {
          from: '85266281556',
          id: 'wamid.list-kapso',
          type: 'interactive',
          interactive: { list_reply: { id: 'list-1' } },
          kapso: { flow_response: {} },
          timestamp: '1774685162',
        },
      }

      const result = parseKapsoWebhook(payload)

      expect(result).not.toBeNull()
      expect(result!.type).toBe('interactive')
      expect(result!.text).toBe('list-1')
      expect(result!.flowResponse).toBeUndefined()
    })
  })

  describe('button template tap (CAMP-001 claim button)', () => {
    it('Kapso format: type button with button.payload → type "button", text = payload', () => {
      const payload = {
        message: {
          from: '85266281556',
          id: 'wamid.claim',
          type: 'button',
          button: { payload: 'CLAIM_abc-123', text: 'Claim' },
          timestamp: '1774685162',
        },
      }

      const result = parseKapsoWebhook(payload)

      expect(result).not.toBeNull()
      expect(result!.type).toBe('button')
      expect(result!.text).toBe('CLAIM_abc-123')
    })

    it('Meta format: type button with button.payload → type "button", text = payload (case preserved)', () => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: '15551234567',
                      id: 'wamid.claim2',
                      type: 'button',
                      button: { payload: 'CLAIM_UUID-Case', text: 'Claim' },
                      timestamp: '1774685162',
                    },
                  ],
                },
              },
            ],
          },
        ],
      }

      const result = parseKapsoWebhook(payload)

      expect(result).not.toBeNull()
      expect(result!.type).toBe('button')
      expect(result!.text).toBe('CLAIM_UUID-Case')
    })

    it('type button with missing button object → type "button", text undefined (null-safe)', () => {
      const payload = {
        message: {
          from: '85266281556',
          id: 'wamid.claim3',
          type: 'button',
          timestamp: '1774685162',
        },
      }

      const result = parseKapsoWebhook(payload)

      expect(result).not.toBeNull()
      expect(result!.type).toBe('button')
      expect(result!.text).toBeUndefined()
    })
  })

  describe('Meta format - image with link key', () => {
    it('extracts imageUrl from link instead of url', () => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: '15551234567',
                      id: 'wamid.meta-img',
                      type: 'image',
                      image: { link: 'https://example.com/meta.jpg', id: 'meta-img-1' },
                      timestamp: '1774685162',
                    },
                  ],
                },
              },
            ],
          },
        ],
      }

      const result = parseKapsoWebhook(payload)

      expect(result).not.toBeNull()
      expect(result!.type).toBe('image')
      expect(result!.imageUrl).toBe('https://example.com/meta.jpg')
      expect(result!.imageId).toBe('meta-img-1')
    })
  })

  describe('Meta format - no messages', () => {
    it('returns null when messages array is empty', () => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                value: {},
              },
            ],
          },
        ],
      }

      const result = parseKapsoWebhook(payload)

      expect(result).toBeNull()
    })
  })

  describe('null payload', () => {
    it('returns null for null input', () => {
      const result = parseKapsoWebhook(null)

      expect(result).toBeNull()
    })
  })

  describe('message without sender (issue #45 — status/echo events)', () => {
    it('returns null for Kapso format message with no from', () => {
      const payload = {
        message: {
          id: 'wamid.nofrom',
          type: 'text',
          text: { body: 'x' },
          timestamp: '1774685162',
        },
      }

      expect(parseKapsoWebhook(payload)).toBeNull()
    })

    it('returns null for Kapso format message with empty from', () => {
      const payload = {
        message: {
          from: '',
          id: 'wamid.emptyfrom',
          type: 'image',
          image: { url: 'https://example.com/img.jpg', id: 'img-1' },
          timestamp: '1774685162',
        },
      }

      expect(parseKapsoWebhook(payload)).toBeNull()
    })

    it('returns null for a non-string from (JSON number) — would throw in masked logging', () => {
      const payload = {
        message: {
          from: 85266281556,
          id: 'wamid.numfrom',
          type: 'text',
          text: { body: 'x' },
          timestamp: '1774685162',
        },
      }

      expect(parseKapsoWebhook(payload)).toBeNull()
    })

    it('returns null for a whitespace-only from', () => {
      const payload = {
        message: {
          from: '   ',
          id: 'wamid.wsfrom',
          type: 'text',
          text: { body: 'x' },
          timestamp: '1774685162',
        },
      }

      expect(parseKapsoWebhook(payload)).toBeNull()
    })

    it('returns null for Meta format message with no from', () => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: 'wamid.meta-nofrom',
                      type: 'text',
                      text: { body: 'Hello' },
                      timestamp: '1774685162',
                    },
                  ],
                },
              },
            ],
          },
        ],
      }

      expect(parseKapsoWebhook(payload)).toBeNull()
    })
  })

  describe('resolveMessageType - unknown type', () => {
    it('returns unknown for unrecognized type', () => {
      const payload = {
        message: {
          from: '85266281556',
          id: 'wamid.unk',
          type: 'video',
          timestamp: '1774685162',
        },
      }

      const result = parseKapsoWebhook(payload)

      expect(result).not.toBeNull()
      expect(result!.type).toBe('unknown')
    })
  })

  describe('extractText - string text', () => {
    it('handles text as plain string', () => {
      const payload = {
        message: {
          from: '85266281556',
          id: 'wamid.str',
          type: 'text',
          text: 'plain string',
          timestamp: '1774685162',
        },
      }

      const result = parseKapsoWebhook(payload)

      expect(result).not.toBeNull()
      expect(result!.text).toBe('plain string')
    })
  })

  describe('WhatsApp Flow submission (nfm_reply) — REPLY-005 AD-7', () => {
    function metaNfmReplyPayload(interactive: Record<string, unknown>) {
      return {
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: '85266281556',
                      id: 'wamid.nfm',
                      type: 'interactive',
                      interactive,
                      timestamp: '1774685162',
                    },
                  ],
                },
              },
            ],
          },
        ],
      }
    }

    it('Meta envelope: decodes response_json into flowResponse and reads flow_token from it', () => {
      const submission = {
        clientName: 'Xavier',
        clientWhatsapp: '85291234567',
        topic: '訂座查詢',
        flow_token: 'cf.v1.rid-1.abc123',
      }
      const payload = metaNfmReplyPayload({
        type: 'nfm_reply',
        nfm_reply: {
          name: 'flow',
          body: 'Sent',
          response_json: JSON.stringify(submission),
        },
      })

      const result = parseKapsoWebhook(payload)

      expect(result).not.toBeNull()
      expect(result!.type).toBe('interactive')
      expect(result!.flowResponse).toEqual(submission)
      expect(result!.flowToken).toBe('cf.v1.rid-1.abc123')
    })

    it('malformed response_json → flowResponse undefined, does not throw', () => {
      const payload = metaNfmReplyPayload({
        type: 'nfm_reply',
        nfm_reply: {
          name: 'flow',
          body: 'Sent',
          response_json: '{not valid json',
        },
      })

      let result: ReturnType<typeof parseKapsoWebhook>
      expect(() => {
        result = parseKapsoWebhook(payload)
      }).not.toThrow()

      expect(result!).not.toBeNull()
      expect(result!.flowResponse).toBeUndefined()
      expect(result!.flowToken).toBeUndefined()
    })

    it('response_json parses to a non-object (array) → flowResponse undefined, does not throw', () => {
      const payload = metaNfmReplyPayload({
        type: 'nfm_reply',
        nfm_reply: { name: 'flow', body: 'Sent', response_json: '[]' },
      })

      expect(() => parseKapsoWebhook(payload)).not.toThrow()
      const result = parseKapsoWebhook(payload)
      expect(result!.flowResponse).toBeUndefined()
    })

    it('response_json parses to a non-object (number) → flowResponse undefined, does not throw', () => {
      const payload = metaNfmReplyPayload({
        type: 'nfm_reply',
        nfm_reply: { name: 'flow', body: 'Sent', response_json: '3' },
      })

      expect(() => parseKapsoWebhook(payload)).not.toThrow()
      const result = parseKapsoWebhook(payload)
      expect(result!.flowResponse).toBeUndefined()
    })

    // Code review H1: the Kapso fallback is gated on the same nfm_reply
    // signal as the raw path (`hasNfmReplySignal`) — it fires when the
    // signal says "this is a flow submission" but the raw `response_json`
    // didn't yield a value, NOT on the mere presence of `kapso.flow_response`
    // anywhere on the message (that was the ungated-hijack bug).
    it('Kapso flat format: falls back to kapso.flow_response when the nfm_reply signal is present but response_json is absent', () => {
      const flowResponse = {
        clientName: 'Xavier',
        clientWhatsapp: '85291234567',
        topic: '其他查詢',
      }
      const payload = {
        message: {
          from: '85266281556',
          id: 'wamid.kapso-nfm',
          type: 'interactive',
          interactive: { type: 'nfm_reply' },
          timestamp: '1774685162',
          kapso: {
            flow_response: flowResponse,
            flow_token: 'cf.v1.rid-2.def456',
          },
        },
      }

      const result = parseKapsoWebhook(payload)

      expect(result).not.toBeNull()
      expect(result!.flowResponse).toEqual(flowResponse)
      expect(result!.flowToken).toBe('cf.v1.rid-2.def456')
    })

    it('non-flow message: flowResponse and flowToken stay undefined', () => {
      const payload = {
        message: {
          from: '85266281556',
          id: 'wamid.plain',
          type: 'text',
          text: { body: 'hi' },
          timestamp: '1774685162',
        },
      }

      const result = parseKapsoWebhook(payload)

      expect(result).not.toBeNull()
      expect(result!.flowResponse).toBeUndefined()
      expect(result!.flowToken).toBeUndefined()
    })
  })
})

describe('verifyKapsoSignature', () => {
  const secret = 'test-secret'
  const body = '{"message":"hello"}'

  function computeSignature(b: string, s: string): string {
    return crypto.createHmac('sha256', s).update(b).digest('hex')
  }

  it('returns true for valid signature', () => {
    const signature = computeSignature(body, secret)

    expect(verifyKapsoSignature(body, signature, secret)).toBe(true)
  })

  it('returns false for invalid signature', () => {
    const signature = computeSignature(body, secret)
    const tampered = signature.slice(0, -1) + (signature.endsWith('0') ? '1' : '0')

    expect(verifyKapsoSignature(body, tampered, secret)).toBe(false)
  })

  it('returns false for wrong length signature', () => {
    expect(verifyKapsoSignature(body, 'tooshort', secret)).toBe(false)
  })

  it('returns false (not throw) for a same-string-length signature with multi-byte chars', () => {
    const signature = computeSignature(body, secret)
    // same JS string length, longer byte length — timingSafeEqual would throw
    const multiByte = signature.slice(0, -1) + 'é'

    expect(verifyKapsoSignature(body, multiByte, secret)).toBe(false)
  })
})
