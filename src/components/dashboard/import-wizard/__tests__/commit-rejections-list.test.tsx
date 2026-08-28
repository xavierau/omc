import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react'

const h = vi.hoisted(() => {
  const state = { queue: [] as unknown[], idx: 0 }
  const setState = vi.fn()
  const useState = (initial: unknown): [unknown, typeof setState] => {
    const value = state.idx < state.queue.length ? state.queue[state.idx] : initial
    state.idx++
    return [value, setState]
  }
  return { state, useState, setState }
})

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useState: h.useState as unknown as typeof actual.useState,
  }
})

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `t:${key}:${JSON.stringify(params)}` : `t:${key}`,
}))

import { CommitRejectionsList } from '@/components/dashboard/import-wizard/commit-rejections-list'
import { toClipboardText } from '@/components/dashboard/import-wizard/commit-rejections-helpers'

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

function seed(copied: boolean) {
  h.state.queue = [copied]
  h.state.idx = 0
}

const rejected = [
  { phoneE164: '+85291111111', reason: 'invalid_phone' as const },
  { phoneE164: '+85292222222', reason: 'duplicate_active' as const, message: 'note' },
]

describe('CommitRejectionsList — T-F2.5 empty', () => {
  it('renders nothing when there are no rejections', () => {
    seed(false)
    const result = CommitRejectionsList({ rejected: [], total: 10 })
    expect(result).toBeNull()
  })
})

describe('CommitRejectionsList — grouping + headline', () => {
  beforeEach(() => {
    seed(false)
    h.setState.mockClear()
  })

  it('carries data-section="commit-rejections" on its root', () => {
    const tree = renderTree(<CommitRejectionsList rejected={rejected} total={12} />)
    expect(tree.some((el) => attr(el, 'data-section') === 'commit-rejections')).toBe(true)
  })

  it('renders one group per reason in the fixed order (T-F2.1)', () => {
    const tree = renderTree(<CommitRejectionsList rejected={rejected} total={12} />)
    const groups = tree.filter((el) => attr(el, 'data-reason-group') !== undefined)
    expect(groups.map((g) => attr(g, 'data-reason-group'))).toEqual([
      'invalid_phone',
      'duplicate_active',
    ])
  })

  it('renders the rejectedTitle headline with count and total', () => {
    const tree = renderTree(<CommitRejectionsList rejected={rejected} total={12} />)
    const headline = tree.find(
      (el) => attr(el, 'children') === `t:confirm.rejectedTitle:{"count":2,"total":12}`
    )
    expect(headline).toBeDefined()
  })

  it('renders phone and message per row', () => {
    const tree = renderTree(<CommitRejectionsList rejected={rejected} total={12} />)
    const items = tree.filter((el) => el.type === 'li')
    const text = items.map((li) => JSON.stringify(attr(li, 'children'))).join('|')
    expect(text).toContain('+85291111111')
    expect(text).toContain('+85292222222')
    expect(text).toContain('note')
  })
})

describe('CommitRejectionsList — copy (T-F2.3)', () => {
  beforeEach(() => {
    seed(false)
    h.setState.mockClear()
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('writes the expected tab-separated text to the clipboard and flips copied to true', async () => {
    const tree = renderTree(<CommitRejectionsList rejected={rejected} total={12} />)
    const button = tree.find((el) => attr(el, 'data-action') === 'copy-rejections') as ReactElement
    const onClick = attr(button, 'onClick') as () => Promise<void>
    await onClick()

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(toClipboardText(rejected))
    expect(h.setState).toHaveBeenCalledWith(true)
  })

  it('clears the copied state back to false after 2s', async () => {
    vi.useFakeTimers()
    const tree = renderTree(<CommitRejectionsList rejected={rejected} total={12} />)
    const button = tree.find((el) => attr(el, 'data-action') === 'copy-rejections') as ReactElement
    const onClick = attr(button, 'onClick') as () => Promise<void>
    await onClick()
    vi.advanceTimersByTime(2000)

    expect(h.setState).toHaveBeenCalledWith(false)
  })

  it('shows the "Copied" label when copied state is true', () => {
    seed(true)
    const tree = renderTree(<CommitRejectionsList rejected={rejected} total={12} />)
    const button = tree.find((el) => attr(el, 'data-action') === 'copy-rejections') as ReactElement
    expect(attr(button, 'children')).toBe('t:confirm.copied')
  })

  it('shows the default "Copy list" label when copied state is false', () => {
    const tree = renderTree(<CommitRejectionsList rejected={rejected} total={12} />)
    const button = tree.find((el) => attr(el, 'data-action') === 'copy-rejections') as ReactElement
    expect(attr(button, 'children')).toBe('t:confirm.copy')
  })
})

describe('CommitRejectionsList — clipboard unavailable (T-F2.4)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('does not throw and does not flip state when navigator.clipboard is undefined', async () => {
    seed(false)
    h.setState.mockClear()
    vi.stubGlobal('navigator', {})
    const tree = renderTree(<CommitRejectionsList rejected={rejected} total={12} />)
    const button = tree.find((el) => attr(el, 'data-action') === 'copy-rejections') as ReactElement
    const onClick = attr(button, 'onClick') as () => Promise<void>

    await expect(onClick()).resolves.not.toThrow()
    expect(h.setState).not.toHaveBeenCalled()
  })
})

describe('CommitRejectionsList — download CSV', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('creates a Blob object URL, clicks a download link, and revokes the URL', () => {
    seed(false)
    const clickSpy = vi.fn()
    const anchor = { href: '', download: '', click: clickSpy }
    vi.stubGlobal('document', { createElement: vi.fn().mockReturnValue(anchor) })
    const createObjectURL = vi.fn().mockReturnValue('blob:mock-url')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })

    const tree = renderTree(<CommitRejectionsList rejected={rejected} total={12} />)
    const button = tree.find(
      (el) => attr(el, 'data-action') === 'download-rejections'
    ) as ReactElement
    const onClick = attr(button, 'onClick') as () => void
    onClick()

    expect(createObjectURL).toHaveBeenCalled()
    expect(clickSpy).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
    expect(anchor.href).toBe('blob:mock-url')
  })
})
