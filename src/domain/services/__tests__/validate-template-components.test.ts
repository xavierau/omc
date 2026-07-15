import { describe, it, expect } from 'vitest'
import type { TemplateComponent } from '@/domain/entities/whatsapp-template'
import { validateTemplateComponents } from '../validate-template-components'

const IMAGE_URL = 'https://cdn.example.com/burger.png'

describe('validateTemplateComponents', () => {
  it('rejects an image header carrying a raw URL under the snake-case key', () => {
    const message = validateTemplateComponents([
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: [IMAGE_URL] } },
    ])

    expect(message).toBeTruthy()
    expect(message).toContain('4:')
    expect(message?.toLowerCase()).toContain('resumable')
  })

  it('rejects an image header carrying a raw URL under the camelCase key', () => {
    const message = validateTemplateComponents([
      { type: 'HEADER', format: 'IMAGE', example: { headerHandle: [IMAGE_URL] } },
    ])

    expect(message).toContain('4:')
  })

  it('rejects an image header with no example at all', () => {
    const message = validateTemplateComponents([{ type: 'HEADER', format: 'IMAGE' }])

    expect(message).toContain('4:')
  })

  it('rejects an image header whose handle list is empty', () => {
    const message = validateTemplateComponents([
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: [] } },
    ])

    expect(message).toContain('4:')
  })

  it('applies the same rule to VIDEO and DOCUMENT headers', () => {
    const video = validateTemplateComponents([
      { type: 'HEADER', format: 'VIDEO', example: { header_handle: [IMAGE_URL] } },
    ])
    const document = validateTemplateComponents([
      { type: 'HEADER', format: 'DOCUMENT', example: { header_handle: [IMAGE_URL] } },
    ])

    expect(video).toContain('4:')
    expect(document).toContain('4:')
  })

  it('exempts TEXT headers', () => {
    const message = validateTemplateComponents([
      { type: 'HEADER', format: 'TEXT', text: 'Welcome {{name}}' },
      { type: 'BODY', text: 'Hi {{customer_name}}' },
    ])

    expect(message).toBeNull()
  })

  it('accepts a template with no header', () => {
    const components: TemplateComponent[] = [
      { type: 'BODY', text: 'Hi {{customer_name}}' },
      { type: 'FOOTER', text: 'Reply STOP to opt out' },
    ]

    expect(validateTemplateComponents(components)).toBeNull()
  })

  it('accepts an image header with a resumable-upload handle', () => {
    const message = validateTemplateComponents([
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['4:aW1hZ2U='] } },
      { type: 'BODY', text: 'Hi {{customer_name}}' },
    ])

    expect(message).toBeNull()
  })
})
