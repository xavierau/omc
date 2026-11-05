import { describe, it, expect, vi } from 'vitest'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => `t:${key}`,
}))
// Radix needs a real renderer (this repo has none), so the sheet is a passthrough
// that honours `open` the way the real one does.
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? children : null),
  SheetContent: ({ children }: { children: ReactNode }) => children,
  SheetHeader: ({ children }: { children: ReactNode }) => children,
  SheetTitle: ({ children }: { children: ReactNode }) => children,
}))

import { RerunCampaignDialog } from '@/components/dashboard/rerun-campaign-dialog'

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

const buttons = (tree: ReactElement[]) =>
  tree.filter((el) => typeof el.type === 'function' && el.type.name === 'Button')

function render(overrides: Partial<Parameters<typeof RerunCampaignDialog>[0]> = {}) {
  const onConfirm = vi.fn()
  const onOpenChange = vi.fn()
  const element = (
    <RerunCampaignDialog open busy={false} onConfirm={onConfirm} onOpenChange={onOpenChange} {...overrides} />
  )
  return { tree: flatten(element), onConfirm, onOpenChange }
}

const confirmButton = (tree: ReactElement[]) =>
  tree.find((el) => (el.props as Record<string, unknown>)['data-testid'] === 'campaign-rerun-confirm')

describe('RerunCampaignDialog (CAMP-014)', () => {
  it('renders nothing while closed, so nothing can fire', () => {
    const { tree } = render({ open: false })
    expect(confirmButton(tree)).toBeUndefined()
  })

  it('fires the action only from the confirm button', () => {
    const { tree, onConfirm } = render()
    expect(onConfirm).not.toHaveBeenCalled()
    ;(confirmButton(tree)?.props as { onClick: () => void }).onClick()
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('cancel closes without firing', () => {
    const { tree, onConfirm, onOpenChange } = render()
    const cancel = buttons(tree).find((el) => el !== confirmButton(tree))
    ;(cancel?.props as { onClick: () => void }).onClick()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('both buttons lock while the request is in flight', () => {
    const { tree } = render({ busy: true })
    for (const b of buttons(tree)) {
      expect((b.props as { disabled?: boolean }).disabled).toBe(true)
    }
  })

  it('says it messages real customers', () => {
    const { tree } = render()
    expect(JSON.stringify(tree.map((el) => (el.props as { children?: unknown }).children))).toContain(
      't:rerunConfirmBody'
    )
  })
})
