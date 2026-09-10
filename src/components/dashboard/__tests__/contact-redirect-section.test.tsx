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

import {
  ContactSettingsPanel,
  deployWarningMessageArgs,
  firstErrorDetail,
  readDeployWarning,
  shouldShowDeployWarning,
} from '@/components/dashboard/contact-redirect-section'
import type { ContactFormSettingsProps } from '@/components/dashboard/contact-form-settings'
import { DEFAULT_LABELS } from '@/domain/services/contact-config'

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
    labels: DEFAULT_LABELS,
    onLabelChange: vi.fn(),
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

  it('reveals the label fields (inside form settings) when mode is form', () => {
    const tree = renderTree(
      <ContactSettingsPanel mode="form" onModeChange={vi.fn()} formSettingsProps={formSettingsProps()} />
    )
    expect(byTestId(tree, 'contact-form-label-fields')).toBeDefined()
  })

  it('hides the label fields when mode is redirect', () => {
    const tree = renderTree(
      <ContactSettingsPanel mode="redirect" onModeChange={vi.fn()} formSettingsProps={formSettingsProps()} />
    )
    expect(byTestId(tree, 'contact-form-label-fields')).toBeUndefined()
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

describe('readDeployWarning', () => {
  function jsonResponse(body: unknown): Response {
    return { json: async () => body } as unknown as Response
  }

  it('returns the error detail when flowDeploy.ok is false — the save itself still succeeded', async () => {
    expect(
      await readDeployWarning(jsonResponse({ success: true, flowDeploy: { ok: false, error: 'validation failed' } }))
    ).toBe('validation failed')
  })

  it('returns an empty string when flowDeploy.ok is false with no error detail', async () => {
    expect(await readDeployWarning(jsonResponse({ success: true, flowDeploy: { ok: false } }))).toBe('')
  })

  it('returns null when flowDeploy.ok is true', async () => {
    expect(await readDeployWarning(jsonResponse({ success: true, flowDeploy: { ok: true, flowId: 'abc' } }))).toBeNull()
  })

  it('returns null when the response carries no flowDeploy field (e.g. redirect-mode save)', async () => {
    expect(await readDeployWarning(jsonResponse({ success: true }))).toBeNull()
  })

  it('returns null when the body is not JSON', async () => {
    const res = { json: async () => { throw new Error('not json') } } as unknown as Response
    expect(await readDeployWarning(res)).toBeNull()
  })
})

// code review M4: pins the exact render-gate expression for acceptance
// criterion 3 ("the admin saw a warning at save time"). This does NOT prove
// the setDeployWarning/setSaved call ordering inside the component's async
// save() — that requires an interactive re-render across a real DOM (jsdom +
// RTL), which this repo intentionally doesn't have; see the backend artifact
// hand-off for what that would take.
describe('shouldShowDeployWarning', () => {
  it('is false before any save (saved=false), regardless of deployWarning', () => {
    expect(shouldShowDeployWarning(false, null)).toBe(false)
    expect(shouldShowDeployWarning(false, 'some warning')).toBe(false)
    expect(shouldShowDeployWarning(false, '')).toBe(false)
  })

  it('is false after a save with no captured warning (deployWarning=null)', () => {
    expect(shouldShowDeployWarning(true, null)).toBe(false)
  })

  it('is true after a save that captured a warning, including an empty-string detail', () => {
    expect(shouldShowDeployWarning(true, 'validation failed')).toBe(true)
    expect(shouldShowDeployWarning(true, '')).toBe(true)
  })
})

// CodeRabbit (PR #72): flowDeploy.ok:false with no error field made
// readDeployWarning return '' (not null), so the banner still rendered but
// interpolated an empty {error} — a dangling "()" in the message. These
// pin the key/values switch that avoids it without changing the
// ok:false-with-no-error => '' contract of readDeployWarning above.
describe('deployWarningMessageArgs', () => {
  it('picks the generic detail-less key for an empty-string warning', () => {
    expect(deployWarningMessageArgs('')).toEqual({ key: 'contactFlowDeployFailedGeneric' })
  })

  it('picks the generic detail-less key for a whitespace-only warning', () => {
    expect(deployWarningMessageArgs('   ')).toEqual({ key: 'contactFlowDeployFailedGeneric' })
  })

  it('picks the detailed key with the trimmed error when a warning has text', () => {
    expect(deployWarningMessageArgs('validation failed')).toEqual({
      key: 'contactFlowDeployFailed',
      values: { error: 'validation failed' },
    })
  })
})
