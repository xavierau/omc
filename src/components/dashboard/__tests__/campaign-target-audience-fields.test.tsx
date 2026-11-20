import { describe, it, expect, vi } from 'vitest'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'

// Node-env tree-walk test (see campaign-tag-picker.test.tsx). The pickers
// call hooks, so they are stubbed; their props stay readable on the tree.

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/components/dashboard/campaign-tag-picker', () => ({
  CampaignTagPicker: () => null,
}))

vi.mock('@/components/dashboard/campaign-member-picker', () => ({
  CampaignMemberPicker: () => null,
}))

import { CampaignTargetAudienceFields } from '@/components/dashboard/campaign-target-audience-fields'
import type { CampaignFormState } from '@/components/dashboard/campaign-form-types'

function flatten(node: ReactNode): ReactElement[] {
  const out: ReactElement[] = []
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return
    out.push(child)
    const props = child.props as { children?: ReactNode }
    if (typeof child.type !== 'function' && props.children !== undefined) {
      out.push(...flatten(props.children))
    }
  })
  return out
}

function tagPickerProps(type: string): { showRecipientCount?: boolean } {
  const form = { type, targetAudience: 'tag', tagIds: ['t-1'], memberIds: [] } as unknown as CampaignFormState
  const tree = flatten(
    CampaignTargetAudienceFields({ form, onChange: () => {}, onMemberIdsChange: () => {}, onTagIdsChange: () => {} })
  )
  const picker = tree.find((el) => typeof el.type === 'function' && el.type.name === 'CampaignTagPicker')
  return picker?.props as { showRecipientCount?: boolean }
}

describe('CampaignTargetAudienceFields — one recipient number (CAMP-016)', () => {
  it.each(['promo', 'winback'])('hides the legacy tag count on a %s campaign (the summary shows it)', (type) => {
    expect(tagPickerProps(type).showRecipientCount).toBe(false)
  })

  it('keeps the legacy tag count on a welcome campaign (no summary there)', () => {
    expect(tagPickerProps('welcome').showRecipientCount).toBe(true)
  })
})
