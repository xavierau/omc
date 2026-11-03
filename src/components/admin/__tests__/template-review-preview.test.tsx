import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react'
import Image from 'next/image'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

import { TemplateReviewPreview } from '@/components/admin/template-review-preview'
import type { TemplateComponent } from '@/domain/entities/whatsapp-template'

function flatten(node: ReactNode): ReactElement[] {
  const out: ReactElement[] = []
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return
    out.push(child)
    if (typeof child.type === 'function' && child.type !== Image) {
      const fn = child.type as (p: unknown) => ReactNode
      out.push(...flatten(fn(child.props)))
      return
    }
    const props = child.props as { children?: ReactNode }
    if (props.children !== undefined) out.push(...flatten(props.children))
  })
  return out
}

const render = (url: string, format: 'IMAGE' | 'VIDEO' | 'DOCUMENT' = 'IMAGE') => {
  const components: TemplateComponent[] = [
    { type: 'HEADER', format, example: { header_handle: [url] } },
    { type: 'BODY', text: 'Body' },
  ]
  return flatten((TemplateReviewPreview as (p: unknown) => ReactNode)({ components }))
}

const loaders = (tree: ReactElement[]) =>
  tree.filter((el) => el.type === Image || el.type === 'img' || el.type === 'video' || el.type === 'a')
const text = (el: ReactElement) => {
  const c = (el.props as { children?: unknown }).children
  return typeof c === 'string' ? c : null
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('TemplateReviewPreview media header', () => {
  it('renders an image for a URL on the project Supabase host', () => {
    const url = 'https://proj.supabase.co/storage/v1/object/public/wa-template-media/a.jpg'
    const tree = render(url)
    const img = tree.find((el) => el.type === Image)
    expect((img?.props as { src?: string })?.src).toBe(url)
  })

  it('renders a video for a URL on a Meta media host', () => {
    const url = 'https://scontent.whatsapp.net/v/t61/a.mp4'
    const video = render(url, 'VIDEO').find((el) => el.type === 'video')
    expect((video?.props as { src?: string })?.src).toBe(url)
  })

  it('links a DOCUMENT on the project Supabase host', () => {
    const url = 'https://proj.supabase.co/storage/v1/object/public/wa-template-media/menu.pdf'
    const a = render(url, 'DOCUMENT').find((el) => el.type === 'a')
    expect((a?.props as { href?: string })?.href).toBe(url)
  })

  it.each(['IMAGE', 'VIDEO', 'DOCUMENT'] as const)('prints an attacker-host %s URL as plain text and loads nothing', (format) => {
    const url = 'https://attacker.example/track.gif'
    const tree = render(url, format)
    expect(loaders(tree)).toEqual([])
    const notice = tree.find(
      (el) => (el.props as { 'data-testid'?: string })['data-testid'] === 'template-review-preview-media-external'
    )
    expect(notice).toBeDefined()
    const texts = tree.map(text)
    expect(texts).toContain('previewMediaExternal')
    expect(texts).toContain(url)
  })
})
