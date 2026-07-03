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
})
