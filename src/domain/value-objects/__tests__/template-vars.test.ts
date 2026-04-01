import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../template-vars'

describe('renderTemplate', () => {
  it('replaces known placeholders', () => {
    const result = renderTemplate(
      'Hi {{name}}, use code {{code}} for {{discount}} off!',
      { name: 'Alice', code: 'ABC123', discount: '20%' }
    )
    expect(result).toBe('Hi Alice, use code ABC123 for 20% off!')
  })

  it('replaces missing vars with empty string', () => {
    const result = renderTemplate('Hello {{name}}!', {})
    expect(result).toBe('Hello !')
  })

  it('returns template as-is when no placeholders', () => {
    const result = renderTemplate('No placeholders here', { name: 'Bob' })
    expect(result).toBe('No placeholders here')
  })

  it('handles multiple occurrences of same var', () => {
    const result = renderTemplate('{{code}} is {{code}}', { code: 'XYZ' })
    expect(result).toBe('XYZ is XYZ')
  })
})
