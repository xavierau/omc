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

const downloadImportTemplate = vi.fn()
vi.mock('@/components/dashboard/import-wizard/import-template', () => ({
  downloadImportTemplate: () => downloadImportTemplate(),
}))

import { CsvFormatHelp } from '@/components/dashboard/import-wizard/csv-format-help'
import { MAX_ROWS } from '@/components/dashboard/import-wizard/step-upload-csv-helpers'
import { MAX_TAGS_PER_ROW } from '@/domain/services/normalize-import-tags'

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

describe('CsvFormatHelp — T-B2.1 help content', () => {
  it('renders the title and the five help lines with their interpolated params', () => {
    const tree = renderTree(<CsvFormatHelp />)
    const texts = tree.map((el) => attr(el, 'children'))

    expect(texts).toContain('t:csv.help.title')
    expect(texts).toContain('t:csv.help.phone')
    expect(texts).toContain('t:csv.help.name')
    expect(texts).toContain('t:csv.help.language')
    expect(texts).toContain(`t:csv.help.tags:{"maxTagsPerRow":${MAX_TAGS_PER_ROW}}`)
    expect(texts).toContain(`t:csv.help.limits:{"maxRows":${MAX_ROWS}}`)
  })
})

describe('CsvFormatHelp — T-B2.2 download button', () => {
  it('renders a data-action="download-template" button labelled csv.downloadTemplate and calls downloadImportTemplate on click', () => {
    const tree = renderTree(<CsvFormatHelp />)
    const button = tree.find((el) => attr(el, 'data-action') === 'download-template') as ReactElement
    expect(button).toBeDefined()
    expect(attr(button, 'children')).toBe('t:csv.downloadTemplate')

    const onClick = attr(button, 'onClick') as () => void
    onClick()
    expect(downloadImportTemplate).toHaveBeenCalledTimes(1)
  })
})

describe('CsvFormatHelp — T-B2.3 DOM hook', () => {
  it('carries data-section="csv-help" on its root', () => {
    const tree = renderTree(<CsvFormatHelp />)
    expect(tree.some((el) => attr(el, 'data-section') === 'csv-help')).toBe(true)
  })
})
