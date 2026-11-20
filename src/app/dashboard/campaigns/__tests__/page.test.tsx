import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'

// CAMP-014: a refused re-run refetches the list and shows the refusal on the
// card, whose error lives in the card's own state. A refetch that swaps the list
// for the skeleton unmounts the card and loses the message before anyone reads it.
const h = vi.hoisted(() => ({ useCampaigns: vi.fn() }))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return { ...actual, useState: (initial: unknown) => [initial, () => {}] }
})
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => `t:${key}` }))
vi.mock('@/hooks/use-campaigns', () => ({ useCampaigns: h.useCampaigns }))
vi.mock('@/hooks/use-campaign-guardrails', () => ({
  useCampaignGuardrails: () => ({ data: null }),
}))
vi.mock('@/components/dashboard/campaign-card', () => ({ CampaignCard: () => null }))
vi.mock('@/components/dashboard/campaign-guardrail-banner', () => ({
  CampaignGuardrailBanner: () => null,
}))
vi.mock('@/components/dashboard/campaign-form-dialog', () => ({ CampaignFormDialog: () => null }))

import CampaignsPage from '../page'
import { CampaignCard } from '@/components/dashboard/campaign-card'
import { buildCampaign } from '@/test-utils/builders'

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

const render = () => flatten(CampaignsPage())
const cards = (tree: ReactElement[]) => tree.filter((el) => el.type === CampaignCard)

describe('CampaignsPage while the list is loading (CAMP-014)', () => {
  const refetch = vi.fn()

  beforeEach(() => vi.clearAllMocks())

  it('keeps the cards mounted during a refetch, so a refusal on a card survives it', () => {
    h.useCampaigns.mockReturnValue({
      campaigns: [buildCampaign({ id: 'c-1', status: 'failed' })],
      isLoading: true,
      error: null,
      refetch,
    })

    expect(cards(render())).toHaveLength(1)
  })

  it('shows the skeleton, not the empty state, on the first load', () => {
    h.useCampaigns.mockReturnValue({ campaigns: [], isLoading: true, error: null, refetch })

    const tree = render()

    expect(cards(tree)).toHaveLength(0)
    expect(JSON.stringify(tree.map((el) => (el.props as { title?: unknown }).title))).not.toContain(
      't:noCampaignsTitle'
    )
  })
})
