import { describe, it, expect } from 'vitest'
import { generateSlug } from '../slug'

describe('generateSlug', () => {
  it('converts name to lowercase hyphenated slug', () => {
    expect(generateSlug('My Restaurant')).toBe('my-restaurant')
  })

  it('strips special characters', () => {
    expect(generateSlug("Bob's Cafe & Grill!")).toBe('bob-s-cafe-grill')
  })

  it('trims leading and trailing hyphens', () => {
    expect(generateSlug('  Hello World  ')).toBe('hello-world')
  })

  it('returns empty string for empty input', () => {
    expect(generateSlug('')).toBe('')
  })
})
