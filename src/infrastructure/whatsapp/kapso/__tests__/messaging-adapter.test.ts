import { describe, it, expect, vi } from 'vitest'

vi.mock('@/infrastructure/kapso/client', () => ({
  sendTextMessage: vi.fn(),
  sendImageMessage: vi.fn(),
  sendInteractiveButtons: vi.fn(),
  sendInteractiveList: vi.fn(),
  sendCtaUrlButton: vi.fn(),
  sendInteractiveFlow: vi.fn(),
}))

import { kapsoMessagingAdapter } from '../messaging-adapter'
import { sendTextMessage, sendImageMessage, sendInteractiveButtons, sendInteractiveList, sendCtaUrlButton, sendInteractiveFlow } from '@/infrastructure/kapso/client'
import type { WhatsAppMessagingPort } from '@/domain/ports/whatsapp-messaging'

describe('kapsoMessagingAdapter', () => {
  it('satisfies WhatsAppMessagingPort interface', () => {
    const port: WhatsAppMessagingPort = kapsoMessagingAdapter
    expect(port).toBeDefined()
    expect(port.sendText).toBeTypeOf('function')
    expect(port.sendImage).toBeTypeOf('function')
    expect(port.sendInteractiveButtons).toBeTypeOf('function')
    expect(port.sendInteractiveList).toBeTypeOf('function')
    expect(port.sendCtaUrlButton).toBeTypeOf('function')
    expect(port.sendInteractiveFlow).toBeTypeOf('function')
  })

  it('delegates sendText to sendTextMessage', async () => {
    await kapsoMessagingAdapter.sendText('phone1', '+1234', 'hello')
    expect(sendTextMessage).toHaveBeenCalledWith('phone1', '+1234', 'hello')
  })

  it('delegates sendImage to sendImageMessage', async () => {
    await kapsoMessagingAdapter.sendImage('phone1', '+1234', 'http://img.png', 'cap')
    expect(sendImageMessage).toHaveBeenCalledWith('phone1', '+1234', 'http://img.png', 'cap')
  })

  it('delegates sendInteractiveButtons', async () => {
    const buttons = [{ id: 'b1', title: 'OK' }]
    await kapsoMessagingAdapter.sendInteractiveButtons('phone1', '+1234', 'body', buttons, 'footer')
    expect(sendInteractiveButtons).toHaveBeenCalledWith('phone1', '+1234', 'body', buttons, 'footer')
  })

  it('delegates sendInteractiveList', async () => {
    const sections = [{ rows: [{ id: 'CONTACT', title: 'Contact us' }] }]
    await kapsoMessagingAdapter.sendInteractiveList('phone1', '+1234', 'body', 'Options', sections, 'footer')
    expect(sendInteractiveList).toHaveBeenCalledWith('phone1', '+1234', 'body', 'Options', sections, 'footer')
  })

  it('delegates sendCtaUrlButton', async () => {
    await kapsoMessagingAdapter.sendCtaUrlButton('phone1', '+1234', 'body', 'Contact us', 'https://wa.me/85291234567', 'footer')
    expect(sendCtaUrlButton).toHaveBeenCalledWith('phone1', '+1234', 'body', 'Contact us', 'https://wa.me/85291234567', 'footer')
  })

  it('delegates sendInteractiveFlow', async () => {
    const params = {
      flowId: 'flow-1',
      flowCta: '填寫表格',
      flowToken: 'cf.v1.r-1.abc',
      screen: 'CONTACT_FORM',
      data: { topics: [], wa_number: '85291234567' },
    }
    await kapsoMessagingAdapter.sendInteractiveFlow('phone1', '+1234', 'body', params, 'footer')
    expect(sendInteractiveFlow).toHaveBeenCalledWith('phone1', '+1234', 'body', params, 'footer')
  })
})
