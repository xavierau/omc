import { describe, it, expect, vi } from 'vitest'
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => `t:${key}`,
}))

vi.mock('@/components/dashboard/image-uploader', () => ({
  ImageUploader: () => null,
}))

vi.mock('@/components/dashboard/video-uploader', () => ({
  VideoUploader: () => null,
}))

import { WaTemplateFormFields } from '@/components/dashboard/wa-template-form-fields'
import { initialWaTemplateForm, type WaTemplateFormState } from '@/components/dashboard/wa-template-form-types'

function flatten(node: ReactNode): ReactElement[] {
  const out: ReactElement[] = []
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return
    out.push(child)
    if (typeof child.type === 'function') {
      const fn = child.type as (p: unknown) => ReactNode
      out.push(...flatten(fn(child.props)))
      return
    }
    const props = child.props as { children?: ReactNode }
    if (props.children !== undefined) out.push(...flatten(props.children))
  })
  return out
}

function renderTree(element: ReactElement): ReactElement[] {
  const fn = element.type as (p: unknown) => ReactNode
  return [...flatten(fn(element.props))]
}

function fieldsFor(headerType: WaTemplateFormState['headerType']): ReactElement[] {
  const form = { ...initialWaTemplateForm, headerType }
  return renderTree(<WaTemplateFormFields form={form} onChange={vi.fn()} />)
}

function hint(tree: ReactElement[]): ReactElement | undefined {
  return tree.find((el) => (el.props as Record<string, unknown>)['data-testid'] === 'image-header-hint')
}

function videoHint(tree: ReactElement[]): ReactElement | undefined {
  return tree.find((el) => (el.props as Record<string, unknown>)['data-testid'] === 'video-header-hint')
}

describe('WaTemplateFormFields image-header hint', () => {
  it('warns that image headers cannot be submitted yet', () => {
    const note = hint(fieldsFor('image'))
    expect(note).toBeDefined()
    expect((note?.props as { children?: unknown }).children).toBe('t:imageHeaderHint')
  })

  it('shows no hint for a text header', () => {
    expect(hint(fieldsFor('text'))).toBeUndefined()
  })

  it('shows no hint when there is no header', () => {
    expect(hint(fieldsFor('none'))).toBeUndefined()
  })
})

describe('WaTemplateFormFields video-header hint (TPL-011)', () => {
  it('shows the video hint for a video header, and no image hint', () => {
    const tree = fieldsFor('video')
    const note = videoHint(tree)
    expect(note).toBeDefined()
    expect((note?.props as { children?: unknown }).children).toBe('t:videoHeaderHint')
    expect(hint(tree)).toBeUndefined()
  })

  it('shows no video hint for an image header', () => {
    expect(videoHint(fieldsFor('image'))).toBeUndefined()
  })

  it('shows no video hint for a text header', () => {
    expect(videoHint(fieldsFor('text'))).toBeUndefined()
  })

  it('shows no video hint when there is no header', () => {
    expect(videoHint(fieldsFor('none'))).toBeUndefined()
  })
})

describe('WaTemplateFormFields header type select (TPL-011)', () => {
  it('includes a Video option', () => {
    const options = fieldsFor('none').filter((el) => el.type === 'option')
    const values = options.map((o) => (o.props as { value?: string }).value)
    expect(values).toContain('video')
  })
})
