import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../template-renderer'

describe('renderTemplate', () => {
  it('replaces a known placeholder with its value', () => {
    const result = renderTemplate('Hello {{name}}', { name: 'Alice' })
    expect(result).toBe('Hello Alice')
  })

  it('replaces multiple known placeholders', () => {
    const result = renderTemplate(
      'Hi {{name}}, use code {{code}} for {{discount}} off!',
      { name: 'Alice', code: 'ABC123', discount: '20%' }
    )
    expect(result).toBe('Hi Alice, use code ABC123 for 20% off!')
  })

  it('replaces repeated placeholders in the same template', () => {
    const result = renderTemplate('{{code}}-{{code}}-{{code}}', { code: 'X' })
    expect(result).toBe('X-X-X')
  })

  it('substitutes unknown placeholders with empty string', () => {
    const result = renderTemplate('Hello {{missing}}!', { name: 'Alice' })
    expect(result).toBe('Hello !')
  })

  it('treats a null value as empty string (not the literal "null")', () => {
    const result = renderTemplate('Hello {{name}}', { name: null })
    expect(result).toBe('Hello ')
  })

  it('treats an undefined value as empty string', () => {
    const result = renderTemplate('Hello {{name}}', { name: undefined })
    expect(result).toBe('Hello ')
  })

  it('stringifies number values', () => {
    const result = renderTemplate('You have {{points}} points', { points: 42 })
    expect(result).toBe('You have 42 points')
  })

  it('returns the template untouched when it has no placeholders', () => {
    const result = renderTemplate('Plain text only', { name: 'Alice' })
    expect(result).toBe('Plain text only')
  })

  it('returns an empty string when the template is empty', () => {
    const result = renderTemplate('', { name: 'Alice' })
    expect(result).toBe('')
  })
})
