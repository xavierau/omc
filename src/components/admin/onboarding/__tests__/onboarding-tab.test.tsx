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

const fixtureView = {
  restaurantId: 'r1',
  path: 'A' as const,
  phase: 'setup' as const,
  checklist: {
    hk_sim_never_used: { checked: true, status: 'pending' as const, checkedAt: null, checkedBy: null },
    verified_meta_business: { checked: true, status: 'pending' as const, checkedAt: null, checkedBy: null },
    display_name_draft_approved: { checked: true, status: 'pending' as const, checkedAt: null, checkedBy: null },
    opt_in_source_documented: { checked: true, status: 'pending' as const, checkedAt: null, checkedBy: null },
    vertical_allowed: { checked: true, status: 'pending' as const, checkedAt: null, checkedBy: null },
    first_three_campaigns_drafted: { checked: true, status: 'pending' as const, checkedAt: null, checkedBy: null },
  },
  kpiGate: { status: 'pass' as const, deliveryRate: 0.97, optOutRate: 0.01, sampleSize: 200 },
  checklistComplete: true,
  nextPhase: 'probe' as const,
  canAdvance: true,
  blockedReasons: [] as never[],
}

const setPath = vi.fn().mockResolvedValue(true)
const updateChecklistItem = vi.fn().mockResolvedValue(true)
const advancePhase = vi.fn().mockResolvedValue(true)

vi.mock('@/hooks/use-admin-tenant-onboarding', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/use-admin-tenant-onboarding')>(
    '@/hooks/use-admin-tenant-onboarding'
  )
  return {
    ...actual,
    useAdminTenantOnboarding: vi.fn(() => ({
      view: fixtureView,
      isLoading: false,
      error: null,
      setPath,
      updateChecklistItem,
      advancePhase,
    })),
  }
})

import { OnboardingTab } from '@/components/admin/onboarding/onboarding-tab'
import { OnboardingPathSelector } from '@/components/admin/onboarding/onboarding-path-selector'
import { OnboardingPhaseIndicator } from '@/components/admin/onboarding/onboarding-phase-indicator'
import { ChecklistEditor } from '@/components/admin/onboarding/checklist-editor'
import { AdvancePhaseButton } from '@/components/admin/onboarding/advance-phase-button'
import { KpiGateSummary } from '@/components/admin/onboarding/kpi-gate-summary'

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

describe('OnboardingTab', () => {
  it('mounts every onboarding sub-widget', () => {
    const tree = renderTree(<OnboardingTab restaurantId="r1" />)
    const types = new Set(tree.map((el) => el.type))
    expect(types.has(OnboardingPathSelector)).toBe(true)
    expect(types.has(OnboardingPhaseIndicator)).toBe(true)
    expect(types.has(ChecklistEditor)).toBe(true)
    expect(types.has(AdvancePhaseButton)).toBe(true)
    expect(types.has(KpiGateSummary)).toBe(true)
  })

  it('passes the fetched view down to phase indicator and kpi summary', () => {
    const tree = renderTree(<OnboardingTab restaurantId="r1" />)
    const phaseEl = tree.find((el) => el.type === OnboardingPhaseIndicator)
    const kpiEl = tree.find((el) => el.type === KpiGateSummary)
    expect((phaseEl?.props as { view: typeof fixtureView }).view).toEqual(fixtureView)
    expect((kpiEl?.props as { gate: typeof fixtureView.kpiGate }).gate).toEqual(fixtureView.kpiGate)
  })

  it('wires onAdvance to the hook advancePhase mutation', () => {
    const tree = renderTree(<OnboardingTab restaurantId="r1" />)
    const advanceEl = tree.find((el) => el.type === AdvancePhaseButton)
    const onAdvance = (advanceEl?.props as { onAdvance: () => void }).onAdvance
    onAdvance()
    expect(advancePhase).toHaveBeenCalled()
  })

  it('wires path selector onChange to setPath', () => {
    const tree = renderTree(<OnboardingTab restaurantId="r1" />)
    const pathEl = tree.find((el) => el.type === OnboardingPathSelector)
    const onChange = (pathEl?.props as { onChange: (p: string) => void }).onChange
    onChange('B1')
    expect(setPath).toHaveBeenCalledWith('B1')
  })

  it('wires checklist onToggle to updateChecklistItem', () => {
    const tree = renderTree(<OnboardingTab restaurantId="r1" />)
    const checkEl = tree.find((el) => el.type === ChecklistEditor)
    const onToggle = (checkEl?.props as { onToggle: (k: string, c: boolean) => void }).onToggle
    onToggle('vertical_allowed', true)
    expect(updateChecklistItem).toHaveBeenCalledWith('vertical_allowed', true)
  })
})
