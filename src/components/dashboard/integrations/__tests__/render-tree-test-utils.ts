// Shared render-tree walker for WI-9's pure/props-driven view components.
// This repo has no jsdom/RTL (vitest runs in the default node environment —
// see vitest.config.ts's `globals: false` and no `environment: 'jsdom'`),
// so a stateless component is exercised by calling its function directly
// and walking the returned element tree — the same technique
// `contact-redirect-section.test.tsx` pioneered for `ContactSettingsPanel`.
// Extracted here (rather than duplicated per file, as that one precedent
// does) because six view components in this directory need it — past the
// third-use DRY threshold (~/Code/.claude/rules/code-quality.md).
//
// Only usable on STATELESS components (no real `useState`/`useEffect`/
// `useContext` reads) — calling a function with real hooks outside an
// actual React render throws or misbehaves, which is exactly why every
// `*Card` container in this directory is split from its pure `*View`.

import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'

export function flatten(node: ReactNode): ReactElement[] {
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

export function renderTree(element: ReactElement): ReactElement[] {
  const fn = element.type as (p: unknown) => ReactNode
  return [...flatten(fn(element.props))]
}

export function byTestId(tree: ReactElement[], id: string): ReactElement | undefined {
  return tree.find((el) => (el.props as Record<string, unknown>)['data-testid'] === id)
}

export function allByTestId(tree: ReactElement[], id: string): ReactElement[] {
  return tree.filter((el) => (el.props as Record<string, unknown>)['data-testid'] === id)
}

/** Every text child of an element, concatenated — for asserting rendered
 * copy (e.g. i18n-mocked keys, interpolated values, or that a raw string
 * like `<script>` appears as literal text, never as markup). */
export function textOf(el: ReactElement | undefined): string {
  if (!el) return ''
  const props = el.props as { children?: ReactNode }
  return flattenText(props.children)
}

function flattenText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flattenText).join('')
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode }
    return flattenText(props.children)
  }
  return ''
}
