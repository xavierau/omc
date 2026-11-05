import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'

// No DOM renderer in this repo (see campaign-form-dialog-tag-hydration.test.tsx):
// useState is a plain cell store, so the container's real handlers can be driven
// across re-renders and the POST observed.
const h = vi.hoisted(() => {
  let cells: unknown[] = []
  let index = 0
  const useState = (initial: unknown): [unknown, (v: unknown) => void] => {
    const i = index++
    if (i >= cells.length) cells.push(initial)
    return [cells[i], (v) => { cells[i] = v }]
  }
  return { useState, rewind: () => { index = 0 }, reset: () => { cells = []; index = 0 } }
})

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return { ...actual, useState: h.useState }
})
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => `t:${key}`,
}))
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? children : null),
  SheetContent: ({ children }: { children: ReactNode }) => children,
  SheetHeader: ({ children }: { children: ReactNode }) => children,
  SheetTitle: ({ children }: { children: ReactNode }) => children,
}))

import { CampaignCard } from '@/components/dashboard/campaign-card'

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

const onExecute = vi.fn()

function render() {
  h.rewind()
  return flatten(
    CampaignCard({
      id: 'camp-1',
      name: 'Nov promo',
      type: 'promo',
      status: 'failed',
      sentCount: 0,
      redeemedCount: 0,
      failureReason: 'Meta said no',
      onExecute,
    })
  )
}

const byTestId = (tree: ReactElement[], id: string) =>
  tree.find((el) => (el.props as Record<string, unknown>)['data-testid'] === id)
const click = (el: ReactElement | undefined) => (el?.props as { onClick: () => unknown }).onClick()

describe('CampaignCard re-run flow (CAMP-014)', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    h.reset()
    onExecute.mockClear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('clicking re-run opens the confirmation and sends nothing', () => {
    click(byTestId(render(), 'campaign-rerun-button'))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(byTestId(render(), 'campaign-rerun-confirm')).toBeDefined()
  })

  it('confirming posts to /rerun once and refreshes the list', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 'queued' }), { status: 200 }))

    click(byTestId(render(), 'campaign-rerun-button'))
    await click(byTestId(render(), 'campaign-rerun-confirm'))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/dashboard/campaigns/camp-1/rerun', { method: 'POST' })
    expect(onExecute).toHaveBeenCalledTimes(1)
    expect(byTestId(render(), 'campaign-rerun-confirm')).toBeUndefined()
  })

  it.each([409, 500])('a %i closes the confirmation, shows the server message and refetches', async (status) => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'OhMyClient could not confirm delivery' }), { status })
    )

    click(byTestId(render(), 'campaign-rerun-button'))
    await click(byTestId(render(), 'campaign-rerun-confirm'))

    const tree = render()
    expect(byTestId(tree, 'campaign-rerun-confirm')).toBeUndefined()
    const err = byTestId(tree, 'campaign-execute-error')
    expect(JSON.stringify((err?.props as { children?: unknown }).children)).toContain(
      'OhMyClient could not confirm delivery'
    )
    // The row may have moved under the card, so the list is read again.
    expect(onExecute).toHaveBeenCalledTimes(1)
  })

  it('a rejected Send Now still does not refetch: only re-run changed', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Daily cap' }), { status: 403 }))
    const active = flatten(
      CampaignCard({
        id: 'camp-1',
        name: 'Nov promo',
        type: 'promo',
        status: 'active',
        sentCount: 0,
        redeemedCount: 0,
        onExecute,
      })
    )
    const send = active.find((el) => (el.props as { children?: unknown }).children === 't:sendNow')

    await click(send)

    expect(onExecute).not.toHaveBeenCalled()
  })

  it('hands the QR-only flag to the confirmation sheet', () => {
    h.rewind()
    const open = () =>
      flatten(
        CampaignCard({
          id: 'camp-1',
          name: 'Nov promo',
          type: 'promo',
          status: 'failed',
          sentCount: 0,
          redeemedCount: 0,
          failureReason: 'Meta said no',
          qrOnlyCoupon: true,
          onExecute,
        })
      )
    click(byTestId(open(), 'campaign-rerun-button'))
    h.rewind()

    expect(byTestId(open(), 'campaign-rerun-qr-only-warning')).toBeDefined()
  })

  it('hands the coupon-config flag to the confirmation sheet', () => {
    h.rewind()
    const open = () =>
      flatten(
        CampaignCard({
          id: 'camp-1',
          name: 'Nov promo',
          type: 'promo',
          status: 'failed',
          sentCount: 0,
          redeemedCount: 0,
          failureReason: 'Meta said no',
          hasCouponConfig: false,
          onExecute,
        })
      )
    click(byTestId(open(), 'campaign-rerun-button'))
    h.rewind()

    const texts = JSON.stringify(open().map((el) => (el.props as { children?: unknown }).children))
    expect(texts).toContain('t:rerunConfirmBody')
    expect(texts).not.toContain('t:rerunCouponExpiry')
  })

  it('a network failure shows the fallback message', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    click(byTestId(render(), 'campaign-rerun-button'))
    await click(byTestId(render(), 'campaign-rerun-confirm'))

    const err = byTestId(render(), 'campaign-execute-error')
    expect(JSON.stringify((err?.props as { children?: unknown }).children)).toContain('t:executeErrorFallback')
    errSpy.mockRestore()
  })
})
