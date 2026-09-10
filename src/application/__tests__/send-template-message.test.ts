import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/whatsapp/templates')

import { sendTemplateMessage } from '@/infrastructure/whatsapp/templates'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import { sendWhatsAppTemplateMessage } from '../send-template-message'
import { TemplateHeaderMediaMissingError } from '../enforce-header-media'
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

  // #127 / CAMP-007: templates declaring a media HEADER must go out with a
  // send-time header parameter carrying the stored public URL, or Meta
  // rejects every send with #132012.
  describe('media header params', () => {
    it('builds an image header param from the stored snake_case header_handle URL', async () => {
      const template = buildTemplate({
        components: [
          {
            type: 'HEADER',
            format: 'IMAGE',
            example: { header_handle: ['https://cdn.example.com/pic.jpg'] },
          },
          { type: 'BODY', text: 'Hello!' },
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
          headerParams: [
            { type: 'image', image: { link: 'https://cdn.example.com/pic.jpg' } },
          ],
        })
      )
    })

    it('builds an image header param from the camelCase headerHandle key', async () => {
      const template = buildTemplate({
        components: [
          {
            type: 'HEADER',
            format: 'IMAGE',
            example: { headerHandle: ['https://cdn.example.com/pic.jpg'] },
          },
          { type: 'BODY', text: 'Hello!' },
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
          headerParams: [
            { type: 'image', image: { link: 'https://cdn.example.com/pic.jpg' } },
          ],
        })
      )
    })

    it('builds a video header param for VIDEO format', async () => {
      const template = buildTemplate({
        components: [
          {
            type: 'HEADER',
            format: 'VIDEO',
            example: { header_handle: ['https://cdn.example.com/clip.mp4'] },
          },
          { type: 'BODY', text: 'Hello!' },
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
          headerParams: [
            { type: 'video', video: { link: 'https://cdn.example.com/clip.mp4' } },
          ],
        })
      )
    })

    it('builds a document header param for DOCUMENT format', async () => {
      const template = buildTemplate({
        components: [
          {
            type: 'HEADER',
            format: 'DOCUMENT',
            example: { header_handle: ['https://cdn.example.com/menu.pdf'] },
          },
          { type: 'BODY', text: 'Hello!' },
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
          headerParams: [
            {
              type: 'document',
              document: { link: 'https://cdn.example.com/menu.pdf' },
            },
          ],
        })
      )
    })

    // KNOWN LIMITATION (#127 journal, deliberately unfixed here): a TEXT
    // header with a {{param}} folds its variable into bodyParams —
    // extractParameters scans ALL components — while headerParams stays
    // undefined, so Meta receives the header variable in the wrong
    // component (same #132012 class). This pins today's behavior so the
    // green suite doesn't read as "TEXT headers fully handled".
    it('KNOWN LIMITATION: a parameterized TEXT header folds its param into bodyParams', async () => {
      const template = buildTemplate({
        components: [
          { type: 'HEADER', format: 'TEXT', text: 'Hi {{name}}' },
          { type: 'BODY', text: 'Hello!' },
        ],
      })

      await sendWhatsAppTemplateMessage({
        phoneNumberId: 'pn-1',
        to: '+85291234567',
        template,
        paramValues: { name: 'Ada' },
      })

      const args = vi.mocked(sendTemplateMessage).mock.calls[0][2]
      expect(args.headerParams).toBeUndefined()
      expect(args.bodyParams).toContainEqual(
        expect.objectContaining({ parameterName: 'name' })
      )
    })

    it('sends no headerParams for a TEXT header', async () => {
      const template = buildTemplate({
        components: [
          { type: 'HEADER', format: 'TEXT', text: 'Big News' },
          { type: 'BODY', text: 'Hello!' },
        ],
      })

      await sendWhatsAppTemplateMessage({
        phoneNumberId: 'pn-1',
        to: '+85291234567',
        template,
        paramValues: {},
      })

      const args = vi.mocked(sendTemplateMessage).mock.calls[0][2]
      expect(args.headerParams).toBeUndefined()
    })

    it('sends no headerParams when the template has no header', async () => {
      const template = buildTemplate({
        components: [{ type: 'BODY', text: 'Hello!' }],
      })

      await sendWhatsAppTemplateMessage({
        phoneNumberId: 'pn-1',
        to: '+85291234567',
        template,
        paramValues: {},
      })

      const args = vi.mocked(sendTemplateMessage).mock.calls[0][2]
      expect(args.headerParams).toBeUndefined()
    })

    it('throws TemplateHeaderMediaMissingError when the stored handle is a 4: upload handle', async () => {
      const template = buildTemplate({
        components: [
          {
            type: 'HEADER',
            format: 'IMAGE',
            example: { header_handle: ['4:aBcDeF=='] },
          },
          { type: 'BODY', text: 'Hello!' },
        ],
      })

      await expect(
        sendWhatsAppTemplateMessage({
          phoneNumberId: 'pn-1',
          to: '+85291234567',
          template,
          paramValues: {},
        })
      ).rejects.toBeInstanceOf(TemplateHeaderMediaMissingError)
      expect(sendTemplateMessage).not.toHaveBeenCalled()
    })

    it('throws TemplateHeaderMediaMissingError when the media header has no handle', async () => {
      const template = buildTemplate({
        components: [
          { type: 'HEADER', format: 'IMAGE' },
          { type: 'BODY', text: 'Hello!' },
        ],
      })

      await expect(
        sendWhatsAppTemplateMessage({
          phoneNumberId: 'pn-1',
          to: '+85291234567',
          template,
          paramValues: {},
        })
      ).rejects.toBeInstanceOf(TemplateHeaderMediaMissingError)
      expect(sendTemplateMessage).not.toHaveBeenCalled()
    })
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
