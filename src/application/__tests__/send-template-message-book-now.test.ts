// BOOK-001 W3 (AC-16): the Book now button's {{1}} carries the recipient's own
// booking token; a coupon URL button in the same template keeps the coupon
// code, each on its own button index.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/infrastructure/whatsapp/templates')

import { sendTemplateMessage } from '@/infrastructure/whatsapp/templates'
import { sendWhatsAppTemplateMessage } from '../send-template-message'
import { okResult } from '@/test-utils/send-result'
import { buildWhatsAppTemplate } from '@/test-utils/builders'
import type { TemplateButton } from '@/domain/entities/whatsapp-template'

const APP = 'https://app.ohmyclient.io'
const bookNow: TemplateButton = { type: 'URL', text: 'Book now', url: `${APP}/b/{{1}}` }
const coupon: TemplateButton = { type: 'URL', text: 'Coupon', url: `${APP}/coupon/{{1}}` }

const template = (buttons: TemplateButton[]) =>
  buildWhatsAppTemplate({ components: [{ type: 'BODY', text: 'Hi {{customer_name}}' }, { type: 'BUTTONS', buttons }] })

function sentButtons() {
  return vi.mocked(sendTemplateMessage).mock.calls[0][2].buttons
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_APP_URL', APP)
  vi.mocked(sendTemplateMessage).mockResolvedValue(okResult())
})
afterEach(() => vi.unstubAllEnvs())

const send = (buttons: TemplateButton[], extra: { couponCode?: string; bookingToken?: string }) =>
  sendWhatsAppTemplateMessage({ phoneNumberId: 'pn', to: '+85291234567', template: template(buttons), paramValues: {}, ...extra })

describe('URL button params with a Book now button', () => {
  it('fills the Book now button with the booking token', async () => {
    await send([bookNow], { bookingToken: 'tok_abc' })
    expect(sentButtons()).toEqual([
      { type: 'button', subType: 'url', index: 0, parameters: [{ type: 'text', text: 'tok_abc' }] },
    ])
  })

  it('a coupon button and a Book now button each get their own param on their own index', async () => {
    await send([coupon, bookNow], { couponCode: 'SAVE20', bookingToken: 'tok_abc' })
    expect(sentButtons()).toEqual([
      { type: 'button', subType: 'url', index: 0, parameters: [{ type: 'text', text: 'SAVE20' }] },
      { type: 'button', subType: 'url', index: 1, parameters: [{ type: 'text', text: 'tok_abc' }] },
    ])
  })

  it('never puts the coupon code on the Book now button (order reversed)', async () => {
    await send([bookNow, coupon], { couponCode: 'SAVE20', bookingToken: 'tok_abc' })
    expect(sentButtons()).toEqual([
      { type: 'button', subType: 'url', index: 0, parameters: [{ type: 'text', text: 'tok_abc' }] },
      { type: 'button', subType: 'url', index: 1, parameters: [{ type: 'text', text: 'SAVE20' }] },
    ])
  })

  it('a non-Book-now send is unchanged: the coupon fills every dynamic URL button', async () => {
    await send([coupon], { couponCode: 'SAVE20' })
    expect(sentButtons()).toEqual([
      { type: 'button', subType: 'url', index: 0, parameters: [{ type: 'text', text: 'SAVE20' }] },
    ])
  })
})
