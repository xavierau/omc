import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => `t:${key}`,
}))

const happyPreflight = {
  allowed: true,
  violations: [],
  audienceCount: 12,
  currentDailySent: 0,
  cap: 50,
  templatePreview: {
    id: 'tpl-utility-1',
    name: 'reconfirmation_consent_v1',
    bodyEn: 'Reply YES to confirm',
    bodyZhHk: '回覆 YES 確認',
  },
  audienceSample: [
    { phoneE164: '+85291234567', capturedAt: '2026-04-30T00:00:00Z' },
    { phoneE164: '+85291234568', capturedAt: '2026-04-29T00:00:00Z' },
  ],
}

const blockedPreflight = {
  allowed: false,
  violations: [
    { key: 'quality_not_green' as const, detail: 'YELLOW since 2026-04-30' },
    { key: 'empty_audience' as const },
  ],
  audienceCount: 0,
  currentDailySent: 0,
  cap: 50,
}

const refetch = vi.fn()
const submit = vi.fn().mockResolvedValue({ campaignId: 'c-7' })

vi.mock('@/hooks/use-reconfirmation-preflight', async () => {
  const actual = await vi.importActual<
    typeof import('@/hooks/use-reconfirmation-preflight')
  >('@/hooks/use-reconfirmation-preflight')
  return {
    ...actual,
    useReconfirmationPreflight: vi.fn(() => ({
      data: happyPreflight,
      isLoading: false,
      error: null,
      refetch,
    })),
  }
})

vi.mock('@/hooks/use-reconfirmation-create', async () => {
  const actual = await vi.importActual<
    typeof import('@/hooks/use-reconfirmation-create')
  >('@/hooks/use-reconfirmation-create')
  return {
    ...actual,
    useReconfirmationCreate: vi.fn(() => ({
      submit,
      isSubmitting: false,
      error: null,
      result: null,
      violations: [],
    })),
  }
})

const setName = vi.fn()
vi.mock('@/components/dashboard/use-reconfirmation-dialog-state', () => ({
  useReconfirmationDialogState: vi.fn(() => ({ name: '', setName })),
}))

import { ReconfirmationCampaignDialog } from '@/components/dashboard/reconfirmation-campaign-dialog'
import { useReconfirmationPreflight } from '@/hooks/use-reconfirmation-preflight'
import { useReconfirmationCreate } from '@/hooks/use-reconfirmation-create'

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
  const result = fn(element.props)
  if (result === null) return []
  return [
    ...(isValidElement(result) ? [result] : []),
    ...flatten(result),
  ]
}

function findByTestId(tree: ReactElement[], id: string): ReactElement | undefined {
  return tree.find(
    (el) => (el.props as Record<string, unknown>)['data-testid'] === id
  )
}

describe('ReconfirmationCampaignDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useReconfirmationPreflight).mockReturnValue({
      data: happyPreflight,
      isLoading: false,
      error: null,
      refetch,
    })
    vi.mocked(useReconfirmationCreate).mockReturnValue({
      submit,
      isSubmitting: false,
      error: null,
      result: null,
      violations: [],
    })
  })

  it('renders the loading state node when isLoading is true', () => {
    vi.mocked(useReconfirmationPreflight).mockReturnValueOnce({
      data: null,
      isLoading: true,
      error: null,
      refetch,
    })
    const tree = renderTree(
      <ReconfirmationCampaignDialog open={true} onOpenChange={() => {}} onCreated={() => {}} />
    )
    expect(findByTestId(tree, 'reconfirmation-loading')).toBeDefined()
  })

  it('renders the error state when error is set', () => {
    vi.mocked(useReconfirmationPreflight).mockReturnValueOnce({
      data: null,
      isLoading: false,
      error: 'boom',
      refetch,
    })
    const tree = renderTree(
      <ReconfirmationCampaignDialog open={true} onOpenChange={() => {}} onCreated={() => {}} />
    )
    expect(findByTestId(tree, 'reconfirmation-error')).toBeDefined()
  })

  it('shows one row per violation in blocked state with data-violation attributes', () => {
    vi.mocked(useReconfirmationPreflight).mockReturnValueOnce({
      data: blockedPreflight,
      isLoading: false,
      error: null,
      refetch,
    })
    const tree = renderTree(
      <ReconfirmationCampaignDialog open={true} onOpenChange={() => {}} onCreated={() => {}} />
    )
    const rows = tree.filter(
      (el) =>
        (el.props as Record<string, unknown>)['data-violation'] !== undefined
    )
    const keys = rows.map(
      (el) => (el.props as Record<string, unknown>)['data-violation']
    )
    expect(keys).toEqual(['quality_not_green', 'empty_audience'])
  })

  it('disables the submit button when allowed=false', () => {
    vi.mocked(useReconfirmationPreflight).mockReturnValueOnce({
      data: blockedPreflight,
      isLoading: false,
      error: null,
      refetch,
    })
    const tree = renderTree(
      <ReconfirmationCampaignDialog open={true} onOpenChange={() => {}} onCreated={() => {}} />
    )
    const submitBtn = findByTestId(tree, 'reconfirmation-submit')
    expect(submitBtn).toBeDefined()
    expect((submitBtn?.props as { disabled?: boolean }).disabled).toBe(true)
  })

  it('shows audience count and template preview when allowed', () => {
    const tree = renderTree(
      <ReconfirmationCampaignDialog open={true} onOpenChange={() => {}} onCreated={() => {}} />
    )
    expect(findByTestId(tree, 'reconfirmation-audience-count')).toBeDefined()
    expect(findByTestId(tree, 'reconfirmation-template-preview')).toBeDefined()
  })

  it('renders one row per audience-sample entry', () => {
    const tree = renderTree(
      <ReconfirmationCampaignDialog open={true} onOpenChange={() => {}} onCreated={() => {}} />
    )
    const rows = tree.filter(
      (el) =>
        (el.props as Record<string, unknown>)['data-audience-row'] !== undefined
    )
    expect(rows).toHaveLength(2)
  })

  it('disables submit until name is entered (allowed=true case)', () => {
    const tree = renderTree(
      <ReconfirmationCampaignDialog open={true} onOpenChange={() => {}} onCreated={() => {}} />
    )
    const submitBtn = findByTestId(tree, 'reconfirmation-submit')
    expect((submitBtn?.props as { disabled?: boolean }).disabled).toBe(true)
  })
})
