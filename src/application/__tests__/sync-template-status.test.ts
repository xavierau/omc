import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/restaurant-repository')
vi.mock('@/infrastructure/whatsapp/templates')
vi.mock('@/infrastructure/supabase/repositories/whatsapp-template-repository')

import { getMetaBusinessAccountId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { listMetaTemplates } from '@/infrastructure/whatsapp/templates'
import { listTemplates, updateTemplate } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { syncTemplateStatus } from '../sync-template-status'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'

function makeLocalTemplate(overrides: Partial<WhatsAppTemplate> = {}): WhatsAppTemplate {
  return {
    id: 'tpl-1',
    restaurantId: 'rest-1',
    metaTemplateId: 'meta-tpl-1',
    name: 'welcome_msg',
    language: 'en',
    category: 'UTILITY',
    status: 'pending',
    components: [],
    parameterFormat: 'NAMED',
    rejectionReason: null,
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
    ...overrides,
  }
}

describe('syncTemplateStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('ba-1')
    vi.mocked(listMetaTemplates).mockResolvedValue([])
    vi.mocked(listTemplates).mockResolvedValue({ templates: [], total: 0 })
    vi.mocked(updateTemplate).mockResolvedValue(undefined as never)
  })

  it('returns empty when no businessAccountId', async () => {
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue(null)

    const result = await syncTemplateStatus('rest-1')

    expect(result).toEqual({ updated: [] })
    expect(listMetaTemplates).not.toHaveBeenCalled()
  })

  it('returns empty when no meta templates', async () => {
    vi.mocked(listMetaTemplates).mockResolvedValue(null as never)

    const result = await syncTemplateStatus('rest-1')

    expect(result).toEqual({ updated: [] })
  })

  it('updates local template when status changed', async () => {
    const local = makeLocalTemplate({ status: 'pending' })
    vi.mocked(listTemplates).mockResolvedValue({ templates: [local], total: 1 })
    vi.mocked(listMetaTemplates).mockResolvedValue([
      { name: 'welcome_msg', language: 'en', status: 'APPROVED', id: 'meta-tpl-1', category: 'UTILITY' },
    ])

    const result = await syncTemplateStatus('rest-1')

    expect(updateTemplate).toHaveBeenCalledWith('tpl-1', { status: 'approved' })
    expect(result.updated).toEqual([
      { id: 'tpl-1', oldStatus: 'pending', newStatus: 'approved' },
    ])
  })

  it('persists the reason Meta gives when a template is rejected', async () => {
    const local = makeLocalTemplate({ status: 'pending' })
    vi.mocked(listTemplates).mockResolvedValue({ templates: [local], total: 1 })
    vi.mocked(listMetaTemplates).mockResolvedValue([
      {
        name: 'welcome_msg',
        language: 'en',
        status: 'REJECTED',
        id: 'meta-tpl-1',
        category: 'UTILITY',
        rejectedReason: 'INVALID_FORMAT',
      },
    ])

    const result = await syncTemplateStatus('rest-1')

    expect(updateTemplate).toHaveBeenCalledWith('tpl-1', {
      status: 'rejected',
      rejectionReason: 'INVALID_FORMAT',
    })
    expect(result.updated).toEqual([
      { id: 'tpl-1', oldStatus: 'pending', newStatus: 'rejected' },
    ])
  })

  it('falls back to a placeholder when Meta reports no rejection reason', async () => {
    const local = makeLocalTemplate({ status: 'pending' })
    vi.mocked(listTemplates).mockResolvedValue({ templates: [local], total: 1 })
    vi.mocked(listMetaTemplates).mockResolvedValue([
      { name: 'welcome_msg', language: 'en', status: 'REJECTED', id: 'meta-tpl-1', category: 'UTILITY' },
    ])

    await syncTemplateStatus('rest-1')

    expect(updateTemplate).toHaveBeenCalledWith('tpl-1', {
      status: 'rejected',
      rejectionReason: 'Rejected by Meta (no reason provided)',
    })
  })

  it('reads the snake_case rejection reason shape too', async () => {
    const local = makeLocalTemplate({ status: 'pending' })
    vi.mocked(listTemplates).mockResolvedValue({ templates: [local], total: 1 })
    vi.mocked(listMetaTemplates).mockResolvedValue([
      {
        name: 'welcome_msg',
        language: 'en',
        status: 'REJECTED',
        id: 'meta-tpl-1',
        category: 'UTILITY',
        rejected_reason: 'SCAM',
      },
    ] as never)

    await syncTemplateStatus('rest-1')

    expect(updateTemplate).toHaveBeenCalledWith('tpl-1', {
      status: 'rejected',
      rejectionReason: 'SCAM',
    })
  })

  it('does not write a rejectionReason on a non-rejected transition', async () => {
    const local = makeLocalTemplate({ status: 'pending' })
    vi.mocked(listTemplates).mockResolvedValue({ templates: [local], total: 1 })
    vi.mocked(listMetaTemplates).mockResolvedValue([
      { name: 'welcome_msg', language: 'en', status: 'APPROVED', id: 'meta-tpl-1', category: 'UTILITY' },
    ])

    await syncTemplateStatus('rest-1')

    expect(vi.mocked(updateTemplate).mock.calls[0][1]).not.toHaveProperty('rejectionReason')
  })

  it('does not update when status is unchanged', async () => {
    const local = makeLocalTemplate({ status: 'approved' })
    vi.mocked(listTemplates).mockResolvedValue({ templates: [local], total: 1 })
    vi.mocked(listMetaTemplates).mockResolvedValue([
      { name: 'welcome_msg', language: 'en', status: 'APPROVED', id: 'meta-tpl-1', category: 'UTILITY' },
    ])

    const result = await syncTemplateStatus('rest-1')

    expect(updateTemplate).not.toHaveBeenCalled()
    expect(result.updated).toEqual([])
  })
})
