import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Campaign } from '@/domain/entities/campaign'
import { buildCampaign } from '@/test-utils/builders'

// #102 fix 2: this resolution used to live only inside execute-campaign.ts.
// It is extracted so the synchronous send-time gate in
// POST /api/dashboard/campaigns/[id]/execute can reuse the EXACT same
// "does this campaign have a sendable template" logic as the worker,
// instead of re-implementing (and risking drift from) it.

vi.mock('@/infrastructure/supabase/repositories/whatsapp-template-repository', () => ({
  findTemplateByIdForRestaurant: vi.fn(),
}))

import {
  resolveWhatsAppTemplate,
  WhatsAppTemplateNotFoundError,
  WhatsAppTemplateNotApprovedError,
} from '../resolve-whatsapp-template'
import { findTemplateByIdForRestaurant } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return buildCampaign(overrides)
}

describe('resolveWhatsAppTemplate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null when the campaign has no whatsappTemplateId', async () => {
    const result = await resolveWhatsAppTemplate(
      campaign({ whatsappTemplateId: null })
    )
    expect(result).toBeNull()
    expect(findTemplateByIdForRestaurant).not.toHaveBeenCalled()
  })

  // Review round 2 (#102 item 3): typed errors so the synchronous execute
  // route can map them to 400/409 with the real message instead of falling
  // through to a generic 500 — a user-caused state must explain itself.
  it('throws WhatsAppTemplateNotFoundError when the referenced template is not found', async () => {
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue(null)

    await expect(
      resolveWhatsAppTemplate(campaign({ whatsappTemplateId: 'tpl-missing' }))
    ).rejects.toThrow('WhatsApp template tpl-missing not found')
    await expect(
      resolveWhatsAppTemplate(campaign({ whatsappTemplateId: 'tpl-missing' }))
    ).rejects.toBeInstanceOf(WhatsAppTemplateNotFoundError)
  })

  it('throws WhatsAppTemplateNotApprovedError when the referenced template is not approved', async () => {
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue({
      id: 'tpl-pending',
      restaurantId: 'r-1',
      metaTemplateId: 'meta-2',
      name: 'pending_template',
      language: 'en',
      category: 'MARKETING',
      status: 'pending',
      components: [],
      parameterFormat: 'NAMED',
      rejectionReason: null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    })

    await expect(
      resolveWhatsAppTemplate(campaign({ whatsappTemplateId: 'tpl-pending' }))
    ).rejects.toThrow('WhatsApp template pending_template is not approved')
    await expect(
      resolveWhatsAppTemplate(campaign({ whatsappTemplateId: 'tpl-pending' }))
    ).rejects.toBeInstanceOf(WhatsAppTemplateNotApprovedError)
  })

  // SEC-001 pattern (#127 review): the campaign row's whatsappTemplateId has
  // no ownership check at write time, so resolution must scope by the
  // campaign's own restaurantId — a foreign template id resolves like a
  // missing one instead of leaking (and sending) another tenant's row.
  it('scopes the lookup by the campaign restaurantId', async () => {
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue(null)

    await expect(
      resolveWhatsAppTemplate(
        campaign({ whatsappTemplateId: 'tpl-foreign', restaurantId: 'r-mine' })
      )
    ).rejects.toBeInstanceOf(WhatsAppTemplateNotFoundError)
    expect(findTemplateByIdForRestaurant).toHaveBeenCalledWith('tpl-foreign', 'r-mine')
  })

  it('returns the template when approved', async () => {
    const template = {
      id: 'tpl-1',
      restaurantId: 'r-1',
      metaTemplateId: 'meta-1',
      name: 'promo_template',
      language: 'en',
      category: 'MARKETING' as const,
      status: 'approved' as const,
      components: [],
      parameterFormat: 'NAMED' as const,
      rejectionReason: null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    }
    vi.mocked(findTemplateByIdForRestaurant).mockResolvedValue(template)

    const result = await resolveWhatsAppTemplate(
      campaign({ whatsappTemplateId: 'tpl-1' })
    )
    expect(result).toEqual(template)
  })
})
