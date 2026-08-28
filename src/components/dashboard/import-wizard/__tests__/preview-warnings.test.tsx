import { describe, it, expect, vi } from 'vitest'
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `t:${key}:${JSON.stringify(params)}` : `t:${key}`,
}))

import { PreviewWarnings } from '@/components/dashboard/import-wizard/preview-warnings'
import type { PreviewLookups } from '@/hooks/use-import-batch'

function flatten(node: ReactNode): ReactElement[] {
  const out: ReactElement[] = []
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return
    out.push(child)
    const props = child.props as { children?: ReactNode }
    if (props.children !== undefined) out.push(...flatten(props.children))
  })
  return out
}

function renderTree(element: ReactElement): ReactElement[] {
  const fn = element.type as (p: unknown) => ReactNode
  return [...flatten(fn(element.props))]
}

function attr(el: ReactElement, name: string): unknown {
  return (el.props as Record<string, unknown>)[name]
}

const rows = [{ phoneE164: '+85291111111', name: null, grade: 'strong' as const, tags: [] }]

function lookups(alreadyMemberPhones: string[], activeConsentPhones: string[]): PreviewLookups {
  return { alreadyMemberPhones, activeConsentPhones, status: 'ok' }
}

describe('PreviewWarnings — merge OFF', () => {
  it('shows the already-member-skip line when a row will be skipped as already-a-member', () => {
    const tree = renderTree(
      <PreviewWarnings rows={rows} lookups={lookups(['+85291111111'], [])} merge={false} />
    )
    const line = tree.find((el) => attr(el, 'data-warning') === 'already-member-skip')
    expect(line).toBeDefined()
    expect(attr(line as ReactElement, 'children')).toBe(
      't:preview.warnAlreadyMemberSkip:{"count":1}'
    )
    expect(tree.some((el) => attr(el, 'data-warning') === 'already-member-merge')).toBe(false)
  })

  it('shows the active-consent line when a row will be skipped for active consent', () => {
    const tree = renderTree(
      <PreviewWarnings rows={rows} lookups={lookups([], ['+85291111111'])} merge={false} />
    )
    const line = tree.find((el) => attr(el, 'data-warning') === 'active-consent')
    expect(line).toBeDefined()
    expect(attr(line as ReactElement, 'children')).toBe(
      't:preview.warnActiveConsent:{"count":1}'
    )
  })
})

describe('PreviewWarnings — merge ON', () => {
  it('shows the already-member-merge line when a row will be merged', () => {
    const tree = renderTree(
      <PreviewWarnings rows={rows} lookups={lookups(['+85291111111'], [])} merge />
    )
    const line = tree.find((el) => attr(el, 'data-warning') === 'already-member-merge')
    expect(line).toBeDefined()
    expect(attr(line as ReactElement, 'children')).toBe(
      't:preview.warnAlreadyMemberMerge:{"count":1}'
    )
    expect(tree.some((el) => attr(el, 'data-warning') === 'already-member-skip')).toBe(false)
  })
})

describe('PreviewWarnings — no warnings', () => {
  it('renders no warning lines when neither set matches any row', () => {
    const tree = renderTree(<PreviewWarnings rows={rows} lookups={lookups([], [])} merge={false} />)
    expect(tree.some((el) => typeof attr(el, 'data-warning') === 'string')).toBe(false)
  })
})

describe('PreviewWarnings — T-F1.7 degraded: skipped_too_many_rows', () => {
  it('renders the skip warning and suppresses per-count lines', () => {
    const degraded: PreviewLookups = { alreadyMemberPhones: [], activeConsentPhones: [], status: 'skipped_too_many_rows' }
    const tree = renderTree(<PreviewWarnings rows={rows} lookups={degraded} merge={false} />)
    const line = tree.find((el) => attr(el, 'data-warning') === 'lookup-skipped')
    expect(line).toBeDefined()
    expect(attr(line as ReactElement, 'children')).toBe(
      't:preview.lookupSkipped:{"count":1}'
    )
    expect(tree.some((el) => attr(el, 'data-warning') === 'already-member-skip')).toBe(false)
  })
})

describe('PreviewWarnings — T-F1.8 degraded: failed', () => {
  it('renders the failure warning', () => {
    const degraded: PreviewLookups = { alreadyMemberPhones: [], activeConsentPhones: [], status: 'failed' }
    const tree = renderTree(<PreviewWarnings rows={rows} lookups={degraded} merge={false} />)
    const line = tree.find((el) => attr(el, 'data-warning') === 'lookup-failed')
    expect(line).toBeDefined()
    expect(attr(line as ReactElement, 'children')).toBe('t:preview.lookupFailed')
  })
})
