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
    expect(message?.toLowerCase()).toContain('re-upload')
  })

  it('rejects an image header carrying a raw URL under the camelCase key', () => {
    const message = validateTemplateComponents([
      { type: 'HEADER', format: 'IMAGE', example: { headerHandle: [IMAGE_URL] } },
    ])

    expect(message).toBeTruthy()
  })

  it('rejects an image header with no example at all', () => {
    const message = validateTemplateComponents([{ type: 'HEADER', format: 'IMAGE' }])

    expect(message).toBeTruthy()
  })

  it('rejects an image header whose handle list is empty', () => {
    const message = validateTemplateComponents([
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: [] } },
    ])

    expect(message).toBeTruthy()
  })

  it('reads the snake-case handle when the camelCase key is present but empty', () => {
    const message = validateTemplateComponents([
      {
        type: 'HEADER',
        format: 'IMAGE',
        example: { headerHandle: [], header_handle: ['4:validhandle'] },
      },
    ])

    expect(message).toBeNull()
  })

  it('applies the same rule to VIDEO and DOCUMENT headers', () => {
    const video = validateTemplateComponents([
      { type: 'HEADER', format: 'VIDEO', example: { header_handle: [IMAGE_URL] } },
    ])
    const document = validateTemplateComponents([
      { type: 'HEADER', format: 'DOCUMENT', example: { header_handle: [IMAGE_URL] } },
    ])

    expect(video).toBeTruthy()
    expect(document).toBeTruthy()
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

  it('rejects a phone button carrying no phone number (#97)', () => {
    const message = validateTemplateComponents([
      { type: 'BODY', text: 'Hi' },
      { type: 'BUTTONS', buttons: [{ type: 'PHONE_NUMBER', text: '+85296283521' }] },
    ])

    expect(message).toBeTruthy()
    expect(message?.toLowerCase()).toContain('phone number')
  })

  it('rejects a phone button whose number is blank', () => {
    const message = validateTemplateComponents([
      { type: 'BUTTONS', buttons: [{ type: 'PHONE_NUMBER', text: 'Call us', phoneNumber: '  ' }] },
    ])

    expect(message).toBeTruthy()
  })

  it('rejects a url button carrying no url', () => {
    const message = validateTemplateComponents([
      { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Order now' }] },
    ])

    expect(message).toBeTruthy()
    expect(message?.toLowerCase()).toContain('link')
  })

  it('rejects a button with no label', () => {
    const message = validateTemplateComponents([
      { type: 'BUTTONS', buttons: [{ type: 'URL', text: '', url: 'https://a.test' }] },
    ])

    expect(message).toBeTruthy()
    expect(message?.toLowerCase()).toContain('label')
  })

  it('names the offending button', () => {
    const message = validateTemplateComponents([
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'URL', text: 'Order now', url: 'https://a.test' },
          { type: 'PHONE_NUMBER', text: 'Call us' },
        ],
      },
    ])

    expect(message).toContain('Button 2')
  })

  it('leaves button types it does not own alone', () => {
    const message = validateTemplateComponents([
      { type: 'BUTTONS', buttons: [{ type: 'COPY_CODE', text: '' }] },
    ])

    expect(message).toBeNull()
  })

  it('accepts fully specified url and phone buttons', () => {
    const message = validateTemplateComponents([
      { type: 'BODY', text: 'Hi {{customer_name}}' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'URL', text: 'Order now', url: 'https://a.test' },
          { type: 'PHONE_NUMBER', text: 'Call us', phoneNumber: '+85296283521' },
        ],
      },
    ])

    expect(message).toBeNull()
  })
})
