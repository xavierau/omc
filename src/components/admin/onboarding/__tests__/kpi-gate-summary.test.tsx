import { describe, it, expect, vi } from 'vitest'
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => `t:${key}`,
}))

import { KpiGateSummary } from '@/components/admin/onboarding/kpi-gate-summary'
import type { KpiGateView } from '@/hooks/use-admin-tenant-onboarding'

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

function tilesByMetric(tree: ReactElement[]): Map<string, ReactElement> {
  const out = new Map<string, ReactElement>()
  for (const el of tree) {
    const metric = (el.props as Record<string, unknown>)['data-metric']
    if (typeof metric === 'string' && !out.has(metric)) out.set(metric, el)
  }
  return out
}

describe('KpiGateSummary', () => {
  it('renders exactly two tiles: delivery and opt_out', () => {
    const gate: KpiGateView = {
      status: 'pass',
      deliveryRate: 0.97,
      optOutRate: 0.01,
      sampleSize: 200,
    }
    const tree = renderTree(<KpiGateSummary gate={gate} />)
    const tiles = tilesByMetric(tree)
    expect([...tiles.keys()].sort()).toEqual(['delivery', 'opt_out'])
  })

  it('marks both tiles as pass when overall status is pass', () => {
    const gate: KpiGateView = {
      status: 'pass',
      deliveryRate: 0.97,
      optOutRate: 0.01,
      sampleSize: 200,
    }
    const tree = renderTree(<KpiGateSummary gate={gate} />)
    const tiles = tilesByMetric(tree)
    expect((tiles.get('delivery')?.props as Record<string, unknown>)['data-variant']).toBe('pass')
    expect((tiles.get('opt_out')?.props as Record<string, unknown>)['data-variant']).toBe('pass')
  })

  it('marks the failing metric as fail and the other as pass', () => {
    const gate: KpiGateView = {
      status: 'fail',
      deliveryRate: 0.92,
      optOutRate: 0.005,
      sampleSize: 250,
      failingMetrics: ['delivery'],
    }
    const tree = renderTree(<KpiGateSummary gate={gate} />)
    const tiles = tilesByMetric(tree)
    expect((tiles.get('delivery')?.props as Record<string, unknown>)['data-variant']).toBe('fail')
    expect((tiles.get('opt_out')?.props as Record<string, unknown>)['data-variant']).toBe('pass')
  })

  it('marks both tiles as insufficient when status is insufficient', () => {
    const gate: KpiGateView = { status: 'insufficient', observed: 12, required: 100 }
    const tree = renderTree(<KpiGateSummary gate={gate} />)
    const tiles = tilesByMetric(tree)
    expect((tiles.get('delivery')?.props as Record<string, unknown>)['data-variant']).toBe('insufficient')
    expect((tiles.get('opt_out')?.props as Record<string, unknown>)['data-variant']).toBe('insufficient')
  })

  it('exposes observed/required counts when insufficient', () => {
    const gate: KpiGateView = { status: 'insufficient', observed: 35, required: 100 }
    const tree = renderTree(<KpiGateSummary gate={gate} />)
    const node = tree.find(
      (el) =>
        typeof el.props === 'object' &&
        (el.props as Record<string, unknown>)['data-insufficient-observed'] !== undefined
    )
    expect((node?.props as Record<string, unknown>)['data-insufficient-observed']).toBe(35)
    expect((node?.props as Record<string, unknown>)['data-insufficient-required']).toBe(100)
  })
})
