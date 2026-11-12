import { describe, it, expect } from 'vitest'
import { PhoneNumber } from '@/domain/value-objects/phone-number'

describe('PhoneNumber', () => {
  describe('create', () => {
    it('normalizes raw digits to + prefix', () => {
      const phone = PhoneNumber.create('85212345678')
      expect(phone.value).toBe('+85212345678')
    })

    it('keeps existing + prefix', () => {
      const phone = PhoneNumber.create('+85212345678')
      expect(phone.value).toBe('+85212345678')
    })

    it('strips spaces', () => {
      const phone = PhoneNumber.create('+852 1234 5678')
      expect(phone.value).toBe('+85212345678')
    })

    it('strips hyphens', () => {
      const phone = PhoneNumber.create('852-1234-5678')
      expect(phone.value).toBe('+85212345678')
    })

    it('strips parentheses', () => {
      const phone = PhoneNumber.create('(852)12345678')
      expect(phone.value).toBe('+85212345678')
    })

    it('throws for fewer than 8 digits', () => {
      expect(() => PhoneNumber.create('1234567')).toThrow(
        'Invalid phone number'
      )
    })

    it('throws for more than 15 digits', () => {
      expect(() => PhoneNumber.create('1234567890123456')).toThrow(
        'Invalid phone number'
      )
    })
  })

  describe('masked', () => {
    it('returns masked value with last 4 chars visible', () => {
      const phone = PhoneNumber.create('+85212345678')
      expect(phone.masked).toBe('••••5678')
    })
  })
})
