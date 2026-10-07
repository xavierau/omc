import { describe, it, expect, vi } from 'vitest'

vi.mock('@/infrastructure/kapso/webhook-parser', () => ({
  parseKapsoWebhook: vi.fn(),
  verifyKapsoSignature: vi.fn(),
}))

import { kapsoWebhookAdapter } from '../webhook-adapter'
import { parseKapsoWebhook, verifyKapsoSignature } from '@/infrastructure/kapso/webhook-parser'
import type { WhatsAppWebhookPort } from '@/domain/ports/whatsapp-webhooks'

describe('kapsoWebhookAdapter', () => {
  it('satisfies WhatsAppWebhookPort interface', () => {
    const port: WhatsAppWebhookPort = kapsoWebhookAdapter
    expect(port).toBeDefined()
  })

  it('delegates parse to parseKapsoWebhook', () => {
    const body = { message: {} }
    const headers = { 'x-sig': 'abc' }
    const log = vi.fn()
    kapsoWebhookAdapter.parse(body, headers, log)
    expect(parseKapsoWebhook).toHaveBeenCalledWith(body, headers, log)
  })

  it('delegates verifySignature to verifyKapsoSignature', () => {
    kapsoWebhookAdapter.verifySignature('body', 'sig', 'secret')
    expect(verifyKapsoSignature).toHaveBeenCalledWith('body', 'sig', 'secret')
  })
})
