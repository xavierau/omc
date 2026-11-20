// TAG-001: Tag entity validates/normalizes a tenant-owned tag at creation.
// Name is trimmed, non-empty and <= 40 chars; color defaults to '#6B7280'.
// normalizeTagName is the shared helper reused by the rename use-case.

import { describe, it, expect } from 'vitest'
import {
  Tag,
  normalizeTagName,
  DEFAULT_TAG_COLOR,
  type CreateTagInput,
} from '../tag'
import { TagValidationError } from '@/domain/services/__errors__/tag-errors'

function buildInput(overrides: Partial<CreateTagInput> = {}): CreateTagInput {
  return { restaurantId: 'rest-1', name: 'VIP', ...overrides }
}

describe('Tag.create — happy path', () => {
  it('returns normalized creation attributes (no id/createdAt — DB defaults)', () => {
    const tag = Tag.create(buildInput())
    expect(tag).toEqual({
      restaurantId: 'rest-1',
      name: 'VIP',
      color: DEFAULT_TAG_COLOR,
    })
  })

  it('trims surrounding whitespace from the name', () => {
    expect(Tag.create(buildInput({ name: '  Regular  ' })).name).toBe('Regular')
  })

  it('applies the default color when none is provided', () => {
    expect(Tag.create(buildInput()).color).toBe('#6B7280')
  })

  it('preserves an explicit color', () => {
    expect(Tag.create(buildInput({ color: '#FF0000' })).color).toBe('#FF0000')
  })

  it('accepts a 40-char name (upper boundary)', () => {
    const name = 'a'.repeat(40)
    expect(Tag.create(buildInput({ name })).name).toBe(name)
  })
})

describe('Tag.create — validation', () => {
  it('rejects an empty name', () => {
    expect(() => Tag.create(buildInput({ name: '' }))).toThrow(TagValidationError)
    expect(() => Tag.create(buildInput({ name: '' }))).toThrow(/empty_name/)
  })

  it('rejects a whitespace-only name', () => {
    expect(() => Tag.create(buildInput({ name: '   ' }))).toThrow(/empty_name/)
  })

  it('rejects a name longer than 40 chars', () => {
    expect(() => Tag.create(buildInput({ name: 'a'.repeat(41) }))).toThrow(
      /name_too_long/
    )
  })
})

describe('normalizeTagName — shared by create and rename', () => {
  it('trims and returns a valid name', () => {
    expect(normalizeTagName('  Loyal  ')).toBe('Loyal')
  })

  it('rejects empty / whitespace-only', () => {
    expect(() => normalizeTagName('   ')).toThrow(TagValidationError)
  })

  it('rejects a name longer than 40 chars', () => {
    expect(() => normalizeTagName('a'.repeat(41))).toThrow(/name_too_long/)
  })
})
