import { describe, it, expect } from 'vitest'
import { validateFieldMapping } from '@/domain/value-objects/pos-field-mapping'

describe('validateFieldMapping', () => {
  const validMapping = {
    transactionId: '$.transaction.id',
    amount: '$.transaction.total',
    currency: 'HKD',
    eventType: '$.event_type',
    eventTypeMapping: { payment_completed: 'sale' },
    customerPhone: null,
    timestamp: null,
  }

  it('returns true for a valid mapping', () => {
    expect(validateFieldMapping(validMapping)).toBe(true)
  })

  it('returns true with empty eventTypeMapping', () => {
    const mapping = { ...validMapping, eventTypeMapping: {} }
    expect(validateFieldMapping(mapping)).toBe(true)
  })

  it('returns false when transactionId is missing', () => {
    const { transactionId, ...rest } = validMapping
    expect(validateFieldMapping(rest)).toBe(false)
  })

  it('returns false when amount is missing', () => {
    const { amount, ...rest } = validMapping
    expect(validateFieldMapping(rest)).toBe(false)
  })

  it('returns false when currency is missing', () => {
    const { currency, ...rest } = validMapping
    expect(validateFieldMapping(rest)).toBe(false)
  })

  it('returns false when eventType is missing', () => {
    const { eventType, ...rest } = validMapping
    expect(validateFieldMapping(rest)).toBe(false)
  })

  it('returns false when eventTypeMapping is missing', () => {
    const { eventTypeMapping, ...rest } = validMapping
    expect(validateFieldMapping(rest)).toBe(false)
  })

  it('returns false for non-object input', () => {
    expect(validateFieldMapping(null)).toBe(false)
    expect(validateFieldMapping(undefined)).toBe(false)
    expect(validateFieldMapping('string')).toBe(false)
    expect(validateFieldMapping(42)).toBe(false)
  })

  it('returns false when required field is not a string', () => {
    const mapping = { ...validMapping, transactionId: 123 }
    expect(validateFieldMapping(mapping)).toBe(false)
  })

  it('returns false when eventTypeMapping is not an object', () => {
    const mapping = { ...validMapping, eventTypeMapping: 'bad' }
    expect(validateFieldMapping(mapping)).toBe(false)
  })
})
