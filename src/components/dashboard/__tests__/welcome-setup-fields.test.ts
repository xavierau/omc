import { describe, it, expect } from 'vitest'
import { parse } from '@formatjs/icu-messageformat-parser'
import { PLACEHOLDERS } from '../welcome-setup-fields'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

describe('welcome-setup-fields PLACEHOLDERS', () => {
  it('uses the double-brace syntax the template renderer expects', () => {
    // Renderer regex: /\{\{(\w+)\}\}/g — must match these tokens literally.
    const DOUBLE_BRACE = /^\{\{\w+\}\}$/
    for (const token of PLACEHOLDERS) {
      expect(token).toMatch(DOUBLE_BRACE)
    }
  })

  it('includes greeting, points, contactName, couponCode', () => {
    expect(PLACEHOLDERS).toEqual(
      expect.arrayContaining(['{{greeting}}', '{{points}}', '{{contactName}}', '{{couponCode}}'])
    )
  })
})

function literalText(source: string): string {
  // ICU type 0 = LITERAL. Node has `.value: string` on literal elements.
  const ast = parse(source, { ignoreTag: true }) as Array<{ type: number; value?: string }>
  return ast.filter((n) => n.type === 0).map((n) => n.value ?? '').join('')
}

describe('returningPlaceholder translations', () => {
  it('en.json renders literal double-brace tokens via ICU MessageFormat', () => {
    const literal = literalText(en.welcomeSetup.returningPlaceholder)
    expect(literal).toContain('{{greeting}}')
    expect(literal).toContain('{{points}}')
  })

  it('zh-HK.json renders literal double-brace tokens via ICU MessageFormat', () => {
    const literal = literalText(zh.welcomeSetup.returningPlaceholder)
    expect(literal).toContain('{{greeting}}')
    expect(literal).toContain('{{points}}')
  })
})
