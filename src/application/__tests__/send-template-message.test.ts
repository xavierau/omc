import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/whatsapp/templates')

import { sendTemplateMessage } from '@/infrastructure/whatsapp/templates'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import { sendWhatsAppTemplateMessage } from '../send-template-message'
import { okResult } from '@/test-utils/send-result'

function buildTemplate(
  overrides: Partial<WhatsAppTemplate> = {}
): WhatsAppTemplate {
  return {
    id: 'tpl-1',
    restaurantId: 'rest-1',
    metaTemplateId: 'meta-1',
    name: 'welcome_msg',
    language: 'en',
    category: 'MARKETING',
    status: 'approved',
    components: [],
    parameterFormat: 'NAMED',
    rejectionReason: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('sendWhatsAppTemplateMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sendTemplateMessage).mockResolvedValue(okResult())
  })

  it('throws for non-approved template', async () => {
    const template = buildTemplate({ status: 'draft' })

    await expect(
      sendWhatsAppTemplateMessage({
        phoneNumberId: 'pn-1',
        to: '+85291234567',
        template,
        paramValues: {},
      })
    ).rejects.toThrow('Template is not approved for sending')
  })

  it('sends with body params extracted from template text', async () => {
    const template = buildTemplate({
      components: [
        {
          type: 'BODY',
          text: 'Hello {{customer_name}}, your code: {{code}}',
        },
      ],
    })

    await sendWhatsAppTemplateMessage({
      phoneNumberId: 'pn-1',
      to: '+85291234567',
      template,
      paramValues: { customer_name: 'Alice', code: 'ABC123' },
    })

    expect(sendTemplateMessage).toHaveBeenCalledWith(
      'pn-1',
      '+85291234567',
      expect.objectContaining({
        templateName: 'welcome_msg',
        language: 'en',
        bodyParams: expect.arrayContaining([
          { type: 'text', text: 'Alice', parameterName: 'customer_name' },
          { type: 'text', text: 'ABC123', parameterName: 'code' },
        ]),
      })
    )
  })

  it('includes URL button params when couponCode and URL button with {{1}}', async () => {
    const template = buildTemplate({
      components: [
        { type: 'BODY', text: 'Welcome!' },
        {
          type: 'BUTTONS',
          buttons: [
            { type: 'URL', text: 'Redeem', url: 'https://example.com/{{1}}' },
          ],
        },
      ],
    })

    await sendWhatsAppTemplateMessage({
      phoneNumberId: 'pn-1',
      to: '+85291234567',
      template,
      paramValues: {},
      couponCode: 'SAVE20',
    })

    expect(sendTemplateMessage).toHaveBeenCalledWith(
      'pn-1',
      '+85291234567',
      expect.objectContaining({
        buttons: [
          {
            type: 'button',
            subType: 'url',
            index: 0,
            parameters: [{ type: 'text', text: 'SAVE20' }],
          },
        ],
      })
    )
  })

  it('returns undefined buttons when no couponCode', async () => {
    const template = buildTemplate({
      components: [
        { type: 'BODY', text: 'Hello!' },
        {
          type: 'BUTTONS',
          buttons: [
            { type: 'URL', text: 'Redeem', url: 'https://example.com/{{1}}' },
          ],
        },
      ],
    })

    await sendWhatsAppTemplateMessage({
      phoneNumberId: 'pn-1',
      to: '+85291234567',
      template,
      paramValues: {},
    })

    expect(sendTemplateMessage).toHaveBeenCalledWith(
      'pn-1',
      '+85291234567',
      expect.objectContaining({
        buttons: undefined,
      })
    )
  })

  // CAMP-001: claim-button quick_reply params.
  it('emits a quick_reply button at the QUICK_REPLY index with the claim payload', async () => {
    const template = buildTemplate({
      components: [
        { type: 'BODY', text: 'Hi {{customer_name}}, {{discount}} off!' },
        {
          type: 'BUTTONS',
          buttons: [
            { type: 'URL', text: 'Visit', url: 'https://example.com/{{1}}' },
            { type: 'QUICK_REPLY', text: 'Claim' },
          ],
        },
      ],
    })

    await sendWhatsAppTemplateMessage({
      phoneNumberId: 'pn-1',
      to: '+85291234567',
      template,
      paramValues: { customer_name: 'Alice', discount: '10%' },
      claimPayload: 'CLAIM_camp-123',
    })

    const args = vi.mocked(sendTemplateMessage).mock.calls[0][2]
    expect(args.buttons).toEqual([
      {
        type: 'button',
        subType: 'quick_reply',
        index: 1,
        parameters: [{ type: 'payload', payload: 'CLAIM_camp-123' }],
      },
    ])
  })

  it('picks the first QUICK_REPLY button index when multiple exist', async () => {
    const template = buildTemplate({
      components: [
        { type: 'BODY', text: 'Hello!' },
        {
          type: 'BUTTONS',
          buttons: [
            { type: 'QUICK_REPLY', text: 'Claim now' },
            { type: 'QUICK_REPLY', text: 'Later' },
          ],
        },
      ],
    })

    await sendWhatsAppTemplateMessage({
      phoneNumberId: 'pn-1',
      to: '+85291234567',
      template,
      paramValues: {},
      claimPayload: 'CLAIM_x',
    })

    const args = vi.mocked(sendTemplateMessage).mock.calls[0][2]
    expect(args.buttons?.[0]).toMatchObject({ index: 0 })
  })

  it('emits no buttons when claimPayload is set but template has no QUICK_REPLY', async () => {
    const template = buildTemplate({
      components: [
        { type: 'BODY', text: 'Hello!' },
        {
          type: 'BUTTONS',
          buttons: [
            { type: 'URL', text: 'Redeem', url: 'https://example.com/{{1}}' },
          ],
        },
      ],
    })

    await sendWhatsAppTemplateMessage({
      phoneNumberId: 'pn-1',
      to: '+85291234567',
      template,
      paramValues: {},
      claimPayload: 'CLAIM_x',
    })

    const args = vi.mocked(sendTemplateMessage).mock.calls[0][2]
    expect(args.buttons).toBeUndefined()
  })
})
