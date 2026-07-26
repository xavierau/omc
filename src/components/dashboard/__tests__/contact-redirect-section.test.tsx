import { describe, it, expect, vi } from 'vitest'
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `t:${key}:${JSON.stringify(vars)}` : `t:${key}`,
}))

import { ContactSettingsPanel, firstErrorDetail } from '@/components/dashboard/contact-redirect-section'
import type { ContactFormSettingsProps } from '@/components/dashboard/contact-form-settings'

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

function formSettingsProps(): ContactFormSettingsProps {
  return {
    notificationEmail: '',
    onNotificationEmailChange: vi.fn(),
    emailInvalid: false,
    topics: ['', '', '', '', ''],
    onTopicChange: vi.fn(),
    ackText: '',
    onAckTextChange: vi.fn(),
  }
}

function byTestId(tree: ReactElement[], id: string): ReactElement | undefined {
  return tree.find((el) => (el.props as Record<string, unknown>)['data-testid'] === id)
}

describe('ContactSettingsPanel', () => {
  it('reveals the form settings when mode is form', () => {
    const tree = renderTree(
      <ContactSettingsPanel mode="form" onModeChange={vi.fn()} formSettingsProps={formSettingsProps()} />
    )
    expect(byTestId(tree, 'contact-form-settings')).toBeDefined()
  })

  it('hides the form settings when mode is redirect', () => {
    const tree = renderTree(
      <ContactSettingsPanel mode="redirect" onModeChange={vi.fn()} formSettingsProps={formSettingsProps()} />
    )
    expect(byTestId(tree, 'contact-form-settings')).toBeUndefined()
  })

  it('marks the redirect radio checked in redirect mode', () => {
    const tree = renderTree(
      <ContactSettingsPanel mode="redirect" onModeChange={vi.fn()} formSettingsProps={formSettingsProps()} />
    )
    const radios = tree.filter((el) => el.type === 'input' && (el.props as { type?: string }).type === 'radio')
    expect(radios).toHaveLength(2)
    expect((radios[0].props as { checked: boolean }).checked).toBe(true)
    expect((radios[1].props as { checked: boolean }).checked).toBe(false)
  })

  it('marks the form radio checked in form mode', () => {
    const tree = renderTree(
      <ContactSettingsPanel mode="form" onModeChange={vi.fn()} formSettingsProps={formSettingsProps()} />
    )
    const radios = tree.filter((el) => el.type === 'input' && (el.props as { type?: string }).type === 'radio')
    expect((radios[0].props as { checked: boolean }).checked).toBe(false)
    expect((radios[1].props as { checked: boolean }).checked).toBe(true)
  })

  it('fires onModeChange when the form radio is picked', () => {
    const onModeChange = vi.fn()
    const tree = renderTree(
      <ContactSettingsPanel mode="redirect" onModeChange={onModeChange} formSettingsProps={formSettingsProps()} />
    )
    const radios = tree.filter((el) => el.type === 'input' && (el.props as { type?: string }).type === 'radio')
    ;(radios[1].props as { onChange: () => void }).onChange()
    expect(onModeChange).toHaveBeenCalledWith('form')
  })

  it('fires onModeChange when the redirect radio is picked', () => {
    const onModeChange = vi.fn()
    const tree = renderTree(
      <ContactSettingsPanel mode="form" onModeChange={onModeChange} formSettingsProps={formSettingsProps()} />
    )
    const radios = tree.filter((el) => el.type === 'input' && (el.props as { type?: string }).type === 'radio')
    ;(radios[0].props as { onChange: () => void }).onChange()
    expect(onModeChange).toHaveBeenCalledWith('redirect')
  })
})

describe('firstErrorDetail', () => {
  function jsonResponse(body: unknown): Response {
    return { json: async () => body } as unknown as Response
  }

  it('returns the error string from a { error } body', async () => {
    expect(await firstErrorDetail(jsonResponse({ error: 'topics must be exactly 5 unique…' }))).toBe(
      'topics must be exactly 5 unique…'
    )
  })

  it('returns null when the body has no error field', async () => {
    expect(await firstErrorDetail(jsonResponse({ success: true }))).toBeNull()
  })

  it('returns null when the body is not JSON', async () => {
    const res = { json: async () => { throw new Error('not json') } } as unknown as Response
    expect(await firstErrorDetail(res)).toBeNull()
  })
})
