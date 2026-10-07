import { describe, it, expect, vi } from 'vitest'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'

import { WaTemplateButtonsSection } from '@/components/dashboard/wa-template-buttons-section'
import { createTemplateButton } from '@/components/dashboard/wa-template-form-types'
import type { TemplateButton } from '@/components/dashboard/wa-template-form-types'

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

function button(overrides: Partial<TemplateButton> = {}): TemplateButton {
  return { ...createTemplateButton(), ...overrides }
}

function selects(tree: ReactElement[]): ReactElement[] {
  return tree.filter((el) => el.type === 'select')
}

function optionValues(select: ReactElement): string[] {
  const children = (select.props as { children?: ReactNode }).children
  return Children.toArray(children).map((o) => ((o as ReactElement).props as { value: string }).value)
}

function textOf(el: ReactElement): string | undefined {
  const children = (el.props as { children?: unknown }).children
  return typeof children === 'string' ? children : undefined
}

function byTestId(tree: ReactElement[], id: string): ReactElement | undefined {
  return tree.find((el) => (el.props as { 'data-testid'?: string })['data-testid'] === id)
}

function inputPlaceholders(tree: ReactElement[]): string[] {
  return tree
    .filter((el) => el.type === 'input')
    .map((el) => (el.props as { placeholder?: string }).placeholder ?? '')
}

describe('WaTemplateButtonsSection quick reply (#132)', () => {
  it('offers a Quick reply option in the type select', () => {
    const tree = renderTree(<WaTemplateButtonsSection buttons={[button()]} onChange={vi.fn()} />)
    const select = selects(tree)[0]

    expect(optionValues(select)).toContain('QUICK_REPLY')
  })

  it('shows no URL or phone input for a quick reply button', () => {
    const tree = renderTree(
      <WaTemplateButtonsSection buttons={[button({ type: 'QUICK_REPLY', text: 'Claim' })]} onChange={vi.fn()} />
    )
    // Only the label input remains — no url/phone field for a quick reply.
    expect(inputPlaceholders(tree)).toEqual(['Button label'])
  })

  it('shows the claim-mode hint for a quick reply button', () => {
    const tree = renderTree(
      <WaTemplateButtonsSection buttons={[button({ type: 'QUICK_REPLY', text: 'Claim' })]} onChange={vi.fn()} />
    )

    expect(textOf(byTestId(tree, 'quick-reply-hint')!)).toContain('claim mode')
  })

  it('still renders the phone input for a phone button and the url input for a url button', () => {
    const phoneTree = renderTree(
      <WaTemplateButtonsSection buttons={[button({ type: 'PHONE_NUMBER', text: 'Call' })]} onChange={vi.fn()} />
    )
    const urlTree = renderTree(
      <WaTemplateButtonsSection buttons={[button({ type: 'URL', text: 'Menu' })]} onChange={vi.fn()} />
    )

    expect(inputPlaceholders(phoneTree)).toEqual(['Button label', '+852 1234 5678'])
    expect(inputPlaceholders(urlTree)).toEqual(['Button label', 'https://...'])
  })
})

describe('WaTemplateButtonsSection UNSUPPORTED button (#132)', () => {
  const unsupported: TemplateButton = {
    type: 'UNSUPPORTED',
    text: 'Copy offer code',
    url: '',
    phoneNumber: '',
    raw: { type: 'COPY_CODE', text: 'Copy offer code' },
  }

  it('renders no type select for an UNSUPPORTED button', () => {
    const tree = renderTree(<WaTemplateButtonsSection buttons={[unsupported]} onChange={vi.fn()} />)

    expect(selects(tree)).toHaveLength(0)
  })

  it('shows a read-only notice explaining the button cannot be edited here', () => {
    const tree = renderTree(<WaTemplateButtonsSection buttons={[unsupported]} onChange={vi.fn()} />)
    expect(textOf(byTestId(tree, 'unsupported-button-notice')!)).toContain("can't be edited here")
  })

  it('Remove on an UNSUPPORTED row drops it from the form state', () => {
    const onChange = vi.fn()
    const tree = renderTree(<WaTemplateButtonsSection buttons={[unsupported]} onChange={onChange} />)
    const removeBtn = tree.find((el) => el.type === 'button' && textOf(el) === 'Remove')!

    ;(removeBtn.props as { onClick: () => void }).onClick()

    expect(onChange).toHaveBeenCalledWith('buttons', [])
  })
})
