import { describe, it, expect } from 'vitest'
import {
  resolveJsonPath,
  createGenericWebhookAdapter,
} from '../webhook-adapter'
import type { PosFieldMapping } from '@/domain/value-objects/pos-field-mapping'

describe('resolveJsonPath', () => {
  it('resolves simple dot path', () => {
    expect(resolveJsonPath({ id: 42 }, '$.id')).toBe(42)
  })

  it('resolves nested path', () => {
    const obj = { transaction: { id: 'tx-1' } }
    expect(resolveJsonPath(obj, '$.transaction.id')).toBe('tx-1')
  })

  it('resolves array index', () => {
    const obj = { items: ['a', 'b', 'c'] }
    expect(resolveJsonPath(obj, '$.items[1]')).toBe('b')
  })

  it('returns undefined for missing path', () => {
    expect(resolveJsonPath({ a: 1 }, '$.b.c')).toBeUndefined()
  })

  it('returns literal string when path does not start with $.', () => {
    expect(resolveJsonPath({}, 'sale')).toBe('sale')
  })
})

describe('createGenericWebhookAdapter', () => {
  const mapping: PosFieldMapping = {
    transactionId: '$.data.txId',
    amount: '$.data.total',
    currency: '$.data.currency',
    eventType: '$.data.type',
    eventTypeMapping: { payment_complete: 'sale', refund_issued: 'refund' },
    customerPhone: '$.data.phone',
    timestamp: '$.data.ts',
  }

  const validBody = {
    data: {
      txId: 'tx-123',
      total: 99.5,
      currency: 'HKD',
      type: 'payment_complete',
      phone: '+85291234567',
      ts: '2026-01-01T00:00:00Z',
    },
  }

  describe('parse', () => {
    it('returns PosWebhookEvent for valid payload', () => {
      const adapter = createGenericWebhookAdapter()
      const result = adapter.parse(validBody, mapping)
      expect(result).toEqual({
        externalTransactionId: 'tx-123',
        type: 'sale',
        amount: 99.5,
        currency: 'HKD',
        customerPhone: '+85291234567',
        timestamp: '2026-01-01T00:00:00Z',
        rawPayload: validBody,
      })
    })

    it('returns null when required field is missing', () => {
      const adapter = createGenericWebhookAdapter()
      const body = { data: { total: 10, type: 'payment_complete' } }
      expect(adapter.parse(body, mapping)).toBeNull()
    })

    it('returns null when event type is unmapped', () => {
      const adapter = createGenericWebhookAdapter()
      const body = {
        data: { txId: 'tx-1', total: 10, currency: 'HKD', type: 'unknown' },
      }
      expect(adapter.parse(body, mapping)).toBeNull()
    })

    it('returns null when no mapping provided', () => {
      const adapter = createGenericWebhookAdapter()
      expect(adapter.parse(validBody)).toBeNull()
    })

    it('returns null when body is falsy', () => {
      const adapter = createGenericWebhookAdapter()
      expect(adapter.parse(null, mapping)).toBeNull()
    })

    it('defaults currency to HKD when missing', () => {
      const adapter = createGenericWebhookAdapter()
      const noCurrencyMapping: PosFieldMapping = {
        ...mapping,
        currency: '$.data.missing_currency',
      }
      const result = adapter.parse(validBody, noCurrencyMapping)
      expect(result?.currency).toBe('HKD')
    })
  })

  describe('verifySignature', () => {
    it('returns true for valid HMAC-SHA256 signature', () => {
      const adapter = createGenericWebhookAdapter()
      const body = '{"test":true}'
      const secret = 'my-secret'
      // Pre-computed: crypto.createHmac('sha256','my-secret').update('{"test":true}').digest('hex')
      const crypto = require('crypto')
      const expected = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex')
      expect(
        adapter.verifySignature(body, `sha256=${expected}`, secret)
      ).toBe(true)
    })

    it('returns false for invalid signature', () => {
      const adapter = createGenericWebhookAdapter()
      expect(
        adapter.verifySignature('body', 'sha256=badhex', 'secret')
      ).toBe(false)
    })

    it('returns false when signature format is wrong', () => {
      const adapter = createGenericWebhookAdapter()
      expect(
        adapter.verifySignature('body', 'md5=abc123', 'secret')
      ).toBe(false)
    })
  })
})
