import { describe, expect, it } from 'vitest'
import { E164Phone } from '../e164-phone'

describe('E164Phone', () => {
  it('accepts an already-normalised E.164 string', () => {
    const phone = E164Phone.of('+85298765432')
    expect(phone.value).toBe('+85298765432')
  })

  it('exposes last4', () => {
    expect(E164Phone.of('+85298765432').last4).toBe('5432')
  })

  it('equals compares by value', () => {
    const a = E164Phone.of('+85298765432')
    const b = E164Phone.of('+85298765432')
    const c = E164Phone.of('+85298765433')
    expect(a.equals(b)).toBe(true)
    expect(a.equals(c)).toBe(false)
  })

  it.each([
    ['missing +', '85298765432'],
    ['leading zero after +', '+0298765432'],
    ['contains a letter', '+852x8765432'],
    ['too short (7 digits)', '+8521234'],
    ['too long (16 digits)', '+85212345678901234'],
    ['empty string', ''],
    ['contains spaces', '+852 9876 5432'],
  ])('rejects %s: %s', (_label, raw) => {
    expect(() => E164Phone.of(raw)).toThrow()
  })
})
