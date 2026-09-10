import { describe, it, expect } from 'vitest'
import { createPosProvider } from '../provider-factory'

describe('createPosProvider', () => {
  it('returns webhook and api adapters for generic provider', () => {
    const adapters = createPosProvider('generic')
    expect(adapters.webhook).toBeDefined()
    expect(adapters.api).toBeDefined()
  })

  it('returned webhook adapter has parse and verifySignature', () => {
    const { webhook } = createPosProvider('generic')
    expect(webhook.parse).toBeTypeOf('function')
    expect(webhook.verifySignature).toBeTypeOf('function')
  })

  it('returned api adapter has verifyTransaction', () => {
    const { api } = createPosProvider('generic')
    expect(api.verifyTransaction).toBeTypeOf('function')
  })

  it('throws for unknown provider', () => {
    expect(() =>
      createPosProvider('nonexistent' as never)
    ).toThrow('Unknown POS provider: "nonexistent"')
  })
})
