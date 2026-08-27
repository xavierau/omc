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

function textOf(el: ReactElement): unknown {
  return (el.props as { children?: unknown }).children
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
    const inputs = tree.filter((el) => el.type === 'input')

    // Only the label input remains — no url/phone field for a quick reply.
    expect(inputs).toHaveLength(1)
  })

  it('shows the claim-mode hint for a quick reply button', () => {
    const tree = renderTree(
      <WaTemplateButtonsSection buttons={[button({ type: 'QUICK_REPLY', text: 'Claim' })]} onChange={vi.fn()} />
    )
    const hint = tree.find((el) => typeof textOf(el) === 'string' && (textOf(el) as string).includes('claim-mode'))

    expect(hint).toBeDefined()
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
    const notice = tree.find(
      (el) => typeof textOf(el) === 'string' && (textOf(el) as string).includes("can't be edited here")
    )

    expect(notice).toBeDefined()
  })

  it('still offers Remove for an UNSUPPORTED button', () => {
    const tree = renderTree(<WaTemplateButtonsSection buttons={[unsupported]} onChange={vi.fn()} />)
    const removeBtn = tree.find((el) => el.type === 'button' && textOf(el) === 'Remove')

    expect(removeBtn).toBeDefined()
  })
})
