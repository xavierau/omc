import { describe, it, expect, beforeEach } from 'vitest'
import {
  getMessagingProvider,
  getTemplateProvider,
  getWebhookProvider,
  _resetProviders,
} from '../provider-factory'

describe('provider-factory', () => {
  beforeEach(() => {
    _resetProviders()
  })

  it('returns kapso messaging provider by default', () => {
    const provider = getMessagingProvider()
    expect(provider.sendText).toBeTypeOf('function')
    expect(provider.sendImage).toBeTypeOf('function')
    expect(provider.sendInteractiveButtons).toBeTypeOf('function')
  })

  it('returns kapso template provider by default', () => {
    const provider = getTemplateProvider()
    expect(provider.createTemplate).toBeTypeOf('function')
    expect(provider.listTemplates).toBeTypeOf('function')
    expect(provider.deleteTemplate).toBeTypeOf('function')
    expect(provider.resolveWabaId).toBeTypeOf('function')
    expect(provider.sendTemplate).toBeTypeOf('function')
  })

  it('returns kapso webhook provider by default', () => {
    const provider = getWebhookProvider()
    expect(provider.parse).toBeTypeOf('function')
    expect(provider.verifySignature).toBeTypeOf('function')
  })

  it('caches provider instances (singleton)', () => {
    const a = getMessagingProvider()
    const b = getMessagingProvider()
    expect(a).toBe(b)
  })

  it('re-evaluates provider after reset', () => {
    getMessagingProvider()
    _resetProviders()
    process.env.WHATSAPP_PROVIDER = 'unknown'
    try {
      expect(() => getMessagingProvider()).toThrow('Unknown WhatsApp provider:')
    } finally {
      delete process.env.WHATSAPP_PROVIDER
    }
  })

  it('throws for unknown provider', () => {
    const original = process.env.WHATSAPP_PROVIDER
    process.env.WHATSAPP_PROVIDER = 'unknown'
    try {
      expect(() => getMessagingProvider()).toThrow('Unknown WhatsApp provider: "unknown"')
    } finally {
      if (original === undefined) delete process.env.WHATSAPP_PROVIDER
      else process.env.WHATSAPP_PROVIDER = original
    }
  })
})
