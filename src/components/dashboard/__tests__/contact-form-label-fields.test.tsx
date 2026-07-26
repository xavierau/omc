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

import { ContactFormLabelFields } from '@/components/dashboard/contact-form-label-fields'
import { DEFAULT_LABELS, LABEL_TITLE_MAX_LEN, LABEL_MAX_LEN } from '@/domain/services/contact-config'

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

function inputs(tree: ReactElement[]): ReactElement[] {
  return tree.filter((el) => el.type === 'input')
}

function baseProps() {
  return {
    labels: DEFAULT_LABELS,
    onLabelChange: vi.fn(),
  }
}

describe('ContactFormLabelFields', () => {
  it('renders exactly five inputs pre-filled with the resolved labels', () => {
    const tree = renderTree(<ContactFormLabelFields {...baseProps()} />)
    const fieldInputs = inputs(tree)
    expect(fieldInputs).toHaveLength(5)
    expect(fieldInputs.map((el) => (el.props as { value: string }).value)).toEqual([
      DEFAULT_LABELS.title,
      DEFAULT_LABELS.nameLabel,
      DEFAULT_LABELS.phoneLabel,
      DEFAULT_LABELS.topicLabel,
      DEFAULT_LABELS.submitLabel,
    ])
  })

  it('caps the title input at LABEL_TITLE_MAX_LEN', () => {
    const tree = renderTree(<ContactFormLabelFields {...baseProps()} />)
    const titleInput = inputs(tree)[0]
    expect((titleInput.props as { maxLength: number }).maxLength).toBe(LABEL_TITLE_MAX_LEN)
  })

  it('caps the remaining four inputs at LABEL_MAX_LEN', () => {
    const tree = renderTree(<ContactFormLabelFields {...baseProps()} />)
    const fieldInputs = inputs(tree).slice(1)
    for (const el of fieldInputs) {
      expect((el.props as { maxLength: number }).maxLength).toBe(LABEL_MAX_LEN)
    }
  })

  it('fires onLabelChange with the field name and new value for the title input', () => {
    const onLabelChange = vi.fn()
    const tree = renderTree(<ContactFormLabelFields {...baseProps()} onLabelChange={onLabelChange} />)
    const titleInput = inputs(tree)[0]
    ;(titleInput.props as { onChange: (e: unknown) => void }).onChange({ target: { value: '新標題' } })
    expect(onLabelChange).toHaveBeenCalledWith('title', '新標題')
  })

  it('fires onLabelChange with the field name and new value for each other input', () => {
    const onLabelChange = vi.fn()
    const tree = renderTree(<ContactFormLabelFields {...baseProps()} onLabelChange={onLabelChange} />)
    const fieldInputs = inputs(tree)
    const fields = ['nameLabel', 'phoneLabel', 'topicLabel', 'submitLabel'] as const
    fields.forEach((field, i) => {
      ;(fieldInputs[i + 1].props as { onChange: (e: unknown) => void }).onChange({ target: { value: `x${i}` } })
      expect(onLabelChange).toHaveBeenCalledWith(field, `x${i}`)
    })
  })

  it('renders custom label values when provided', () => {
    const custom = {
      title: '自訂標題',
      nameLabel: '客名',
      phoneLabel: '電話',
      topicLabel: '主題',
      submitLabel: '送出',
    }
    const tree = renderTree(<ContactFormLabelFields labels={custom} onLabelChange={vi.fn()} />)
    const fieldInputs = inputs(tree)
    expect(fieldInputs.map((el) => (el.props as { value: string }).value)).toEqual([
      custom.title,
      custom.nameLabel,
      custom.phoneLabel,
      custom.topicLabel,
      custom.submitLabel,
    ])
  })
})
