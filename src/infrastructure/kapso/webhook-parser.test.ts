import { describe, it, expect } from 'vitest'
import { parseKapsoWebhook, type KapsoMessage } from './webhook-parser'

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
})
