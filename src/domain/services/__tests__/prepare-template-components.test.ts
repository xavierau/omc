import { describe, it, expect } from 'vitest'
import type { TemplateComponent } from '@/domain/entities/whatsapp-template'
import {
  normalizeTemplateComponents,
  prepareTemplateComponents,
} from '../prepare-template-components'

function deepFreeze<T>(value: T): T {
  for (const key of Object.getOwnPropertyNames(value)) {
    const child = (value as Record<string, unknown>)[key]
    if (child && typeof child === 'object') deepFreeze(child)
  }
  return Object.freeze(value)
}

describe('prepareTemplateComponents', () => {
  it('injects an example for every named param in a BODY', () => {
    const components: TemplateComponent[] = [
      { type: 'BODY', text: 'Hi {{customer_name}}, code {{code}}' },
    ]

    const [body] = prepareTemplateComponents(components)

    expect(body.example).toEqual({
      bodyTextNamedParams: [
        { paramName: 'customer_name', example: 'John' },
        { paramName: 'code', example: 'ABC123' },
      ],
    })
  })

  it('falls back to "example" for a param with no known sample value', () => {
    const components: TemplateComponent[] = [{ type: 'BODY', text: 'Hi {{whatever}}' }]

    const [body] = prepareTemplateComponents(components)

    expect(body.example).toEqual({
      bodyTextNamedParams: [{ paramName: 'whatever', example: 'example' }],
    })
  })

  it('injects HEADER text params under headerTextNamedParams', () => {
    const components: TemplateComponent[] = [
      { type: 'HEADER', format: 'TEXT', text: 'Welcome {{name}}' },
    ]

    const [header] = prepareTemplateComponents(components)

    expect(header.example).toEqual({
      headerTextNamedParams: [{ paramName: 'name', example: 'John' }],
    })
  })

  it('leaves components without text, and text without params, untouched', () => {
    const components: TemplateComponent[] = [
      { type: 'FOOTER', text: 'No params here' },
      { type: 'HEADER', format: 'IMAGE' },
    ]

    const [footer, header] = prepareTemplateComponents(components)

    expect(footer).toEqual({ type: 'FOOTER', text: 'No params here' })
    expect(header).toEqual({ type: 'HEADER', format: 'IMAGE' })
  })

  it('replaces COPY_CODE button text and leaves other button types alone', () => {
    const components: TemplateComponent[] = [
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'COPY_CODE', text: 'whatever the user typed' },
          { type: 'URL', text: 'Visit us', url: 'https://example.com' },
          { type: 'QUICK_REPLY', text: 'Stop' },
        ],
      },
    ]

    const [buttons] = prepareTemplateComponents(components)

    expect(buttons.buttons).toEqual([
      { type: 'COPY_CODE', text: 'Copy offer code' },
      { type: 'URL', text: 'Visit us', url: 'https://example.com' },
      { type: 'QUICK_REPLY', text: 'Stop' },
    ])
  })

  it('normalizes full-width braces and still injects the example', () => {
    const components: TemplateComponent[] = [
      { type: 'BODY', text: 'Hi ｛｛customer_name｝｝' },
    ]

    const [body] = prepareTemplateComponents(components)

    expect(body.text).toBe('Hi {{customer_name}}')
    expect(body.example).toEqual({
      bodyTextNamedParams: [{ paramName: 'customer_name', example: 'John' }],
    })
  })

  it('emits a camelCase headerHandle from the snake-case form shape', () => {
    const components: TemplateComponent[] = [
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['4:abc'] } },
    ]

    const [header] = prepareTemplateComponents(components)

    expect(header.example).toEqual({ headerHandle: ['4:abc'] })
  })

  it('emits a camelCase headerHandle from the camelCase entity shape', () => {
    const components: TemplateComponent[] = [
      { type: 'HEADER', format: 'IMAGE', example: { headerHandle: ['4:abc'] } },
    ]

    const [header] = prepareTemplateComponents(components)

    expect(header.example).toEqual({ headerHandle: ['4:abc'] })
  })

  it('does not mutate its input', () => {
    const components: TemplateComponent[] = deepFreeze([
      { type: 'BODY', text: 'Hi ｛｛customer_name｝｝' },
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['4:abc'] } },
      { type: 'BUTTONS', buttons: [{ type: 'COPY_CODE', text: 'original' }] },
    ] as TemplateComponent[])

    const result = prepareTemplateComponents(components)

    expect(components[0].text).toBe('Hi ｛｛customer_name｝｝')
    expect(components[0].example).toBeUndefined()
    expect(components[1].example).toEqual({ header_handle: ['4:abc'] })
    expect(components[2].buttons?.[0].text).toBe('original')
    expect(result[0]).not.toBe(components[0])
  })
})

describe('normalizeTemplateComponents', () => {
  it('converts full-width braces to ASCII in component text', () => {
    const result = normalizeTemplateComponents([
      { type: 'BODY', text: '你好 ｛｛customer_name｝｝' },
    ])

    expect(result).toEqual([{ type: 'BODY', text: '你好 {{customer_name}}' }])
  })

  it('leaves components without text alone', () => {
    const result = normalizeTemplateComponents([{ type: 'HEADER', format: 'IMAGE' }])

    expect(result).toEqual([{ type: 'HEADER', format: 'IMAGE' }])
  })

  it('does not inject examples', () => {
    const result = normalizeTemplateComponents([{ type: 'BODY', text: 'Hi {{code}}' }])

    expect(result[0].example).toBeUndefined()
  })

  it('is idempotent', () => {
    const once = normalizeTemplateComponents([{ type: 'BODY', text: 'Hi ｛｛code｝｝' }])
    const twice = normalizeTemplateComponents(once)

    expect(twice).toEqual(once)
  })
})
