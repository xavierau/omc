import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  getEmailProvider,
  _resetProviders,
} from '../provider-factory'

const ORIGINAL_ENV = process.env

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV }
  _resetProviders()
})

afterEach(() => {
  process.env = ORIGINAL_ENV
})

describe('email provider-factory', () => {
  it('returns resend email provider by default', () => {
    const provider = getEmailProvider()
    expect(provider.send).toBeTypeOf('function')
  })

  it('caches provider instances (singleton)', () => {
    const a = getEmailProvider()
    const b = getEmailProvider()
    expect(a).toBe(b)
  })

  it('re-evaluates provider after reset', () => {
    getEmailProvider()
    _resetProviders()
    process.env.EMAIL_PROVIDER = 'unknown'
    expect(() => getEmailProvider()).toThrow('Unknown email provider:')
  })

  it('throws for unknown provider', () => {
    process.env.EMAIL_PROVIDER = 'unknown'
    expect(() => getEmailProvider()).toThrow('Unknown email provider: "unknown"')
  })
})
