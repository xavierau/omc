import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/idempotency', () => ({
  tryMarkProcessed: vi.fn(),
}))
vi.mock(
  '@/infrastructure/supabase/repositories/whatsapp-template-repository',
  () => ({
    findByMetaTemplateId: vi.fn(),
    findByNameAndLanguage: vi.fn(),
    update: vi.fn(),
  })
)

import { tryMarkProcessed } from '@/infrastructure/supabase/idempotency'
import {
  findByMetaTemplateId,
  findByNameAndLanguage,
  update as updateTemplate,
} from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { routeTemplateStatusEvent } from '../template-status-handlers'
import type { LogFn } from '@/domain/ports/whatsapp-webhooks'
import type {
  TemplateStatus,
  WhatsAppTemplate,
} from '@/domain/entities/whatsapp-template'

function metaTemplateStatusBody(
  changes: Array<{
    metaTemplateId?: number | string | null
    templateName?: string | null
    language?: string | null
    event?: string
    reason?: string
  }>,
  wabaId = 'WABA-1'
) {
  return {
    entry: [
      {
        id: wabaId,
        changes: changes.map((c) => ({
          field: 'message_template_status_update',
          value: {
            event: c.event ?? 'APPROVED',
            ...(c.metaTemplateId !== null && {
              message_template_id: c.metaTemplateId ?? 111,
            }),
            ...(c.templateName !== null && {
              message_template_name: c.templateName ?? 'offer_promotion',
            }),
            ...(c.language !== null && {
              message_template_language: c.language ?? 'zh_HK',
            }),
            ...(c.reason !== undefined && { reason: c.reason }),
          },
        })),
      },
    ],
  }
}

function singleChangeBody(opts: {
  metaTemplateId?: number | string | null
  templateName?: string | null
  language?: string | null
  event?: string
  reason?: string
} = {}) {
  return metaTemplateStatusBody([opts])
}

function templateFixture(overrides: Partial<WhatsAppTemplate> = {}): WhatsAppTemplate {
  return {
    id: 'tpl-1',
    restaurantId: 'rest-1',
    metaTemplateId: '111',
    name: 'offer_promotion',
    language: 'zh_HK',
    category: 'MARKETING',
    status: 'pending',
    components: [],
    parameterFormat: 'NAMED',
    rejectionReason: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('routeTemplateStatusEvent', () => {
  let logs: Array<[string, string, unknown]>
  const log: LogFn = (level, event, data) => {
    logs.push([level, event, data])
  }

  beforeEach(() => {
    vi.clearAllMocks()
    logs = []
    vi.mocked(tryMarkProcessed).mockResolvedValue('new')
    vi.mocked(findByMetaTemplateId).mockResolvedValue(null)
    vi.mocked(findByNameAndLanguage).mockResolvedValue(null)
    vi.mocked(updateTemplate).mockResolvedValue(templateFixture())
  })

  it('APPROVED on local pending (found by meta id) updates with no rejectionReason key', async () => {
    vi.mocked(findByMetaTemplateId).mockResolvedValue(
      templateFixture({ status: 'pending' })
    )

    await routeTemplateStatusEvent(singleChangeBody({ event: 'APPROVED' }), 'rest-1', log)

    expect(updateTemplate).toHaveBeenCalledTimes(1)
    expect(updateTemplate).toHaveBeenCalledWith('tpl-1', { status: 'approved' })
    const updated = logs.find((l) => l[1] === 'webhook.template_status_updated')
    expect(updated?.[2]).toMatchObject({
      templateId: 'tpl-1',
      oldStatus: 'pending',
      newStatus: 'approved',
    })
  })

  it('REJECTED with a textual reason persists rejectionReason', async () => {
    vi.mocked(findByMetaTemplateId).mockResolvedValue(
      templateFixture({ status: 'pending' })
    )

    await routeTemplateStatusEvent(
      singleChangeBody({ event: 'REJECTED', reason: 'Sample media mismatch' }),
      'rest-1',
      log
    )

    expect(updateTemplate).toHaveBeenCalledWith('tpl-1', {
      status: 'rejected',
      rejectionReason: 'Sample media mismatch',
    })
  })

  it('REJECTED with reason "NONE" persists the NO_REJECTION_REASON default', async () => {
    vi.mocked(findByMetaTemplateId).mockResolvedValue(
      templateFixture({ status: 'pending' })
    )

    await routeTemplateStatusEvent(
      singleChangeBody({ event: 'REJECTED', reason: 'NONE' }),
      'rest-1',
      log
    )

    expect(updateTemplate).toHaveBeenCalledWith('tpl-1', {
      status: 'rejected',
      rejectionReason: 'Rejected by Meta (no reason provided)',
    })
  })

  it('REJECTED with absent reason persists the NO_REJECTION_REASON default', async () => {
    vi.mocked(findByMetaTemplateId).mockResolvedValue(
      templateFixture({ status: 'pending' })
    )

    await routeTemplateStatusEvent(
      singleChangeBody({ event: 'REJECTED' }),
      'rest-1',
      log
    )

    expect(updateTemplate).toHaveBeenCalledWith('tpl-1', {
      status: 'rejected',
      rejectionReason: 'Rejected by Meta (no reason provided)',
    })
  })

  it('meta-id miss falls back to name+language lookup and applies the update', async () => {
    vi.mocked(findByMetaTemplateId).mockResolvedValue(null)
    vi.mocked(findByNameAndLanguage).mockResolvedValue(
      templateFixture({ status: 'pending' })
    )

    await routeTemplateStatusEvent(singleChangeBody({ event: 'APPROVED' }), 'rest-1', log)

    expect(findByNameAndLanguage).toHaveBeenCalledWith(
      'rest-1',
      'offer_promotion',
      'zh_HK'
    )
    expect(updateTemplate).toHaveBeenCalledWith('tpl-1', { status: 'approved' })
  })

  it('null meta id goes straight to the name+language fallback (meta-id lookup skipped)', async () => {
    vi.mocked(findByNameAndLanguage).mockResolvedValue(
      templateFixture({ status: 'pending' })
    )

    await routeTemplateStatusEvent(
      singleChangeBody({ event: 'APPROVED', metaTemplateId: null }),
      'rest-1',
      log
    )

    expect(findByMetaTemplateId).not.toHaveBeenCalled()
    expect(findByNameAndLanguage).toHaveBeenCalledWith(
      'rest-1',
      'offer_promotion',
      'zh_HK'
    )
    expect(updateTemplate).toHaveBeenCalledTimes(1)
  })

  it('unknown template (both lookups miss) warns and does not update or throw', async () => {
    await expect(
      routeTemplateStatusEvent(singleChangeBody({ event: 'APPROVED' }), 'rest-1', log)
    ).resolves.toBeUndefined()

    expect(updateTemplate).not.toHaveBeenCalled()
    const warned = logs.find((l) => l[1] === 'webhook.template_not_found')
    expect(warned).toBeDefined()
  })

  it.each<TemplateStatus>(['draft', 'rejected', 'disabled'])(
    'local status %s is never mutated by the webhook',
    async (status) => {
      vi.mocked(findByMetaTemplateId).mockResolvedValue(templateFixture({ status }))

      await routeTemplateStatusEvent(
        singleChangeBody({ event: 'APPROVED' }),
        'rest-1',
        log
      )

      expect(updateTemplate).not.toHaveBeenCalled()
    }
  )

  it('same mapped status as current: no-op write suppression', async () => {
    vi.mocked(findByMetaTemplateId).mockResolvedValue(
      templateFixture({ status: 'approved' })
    )

    await routeTemplateStatusEvent(singleChangeBody({ event: 'APPROVED' }), 'rest-1', log)

    expect(updateTemplate).not.toHaveBeenCalled()
  })

  it('unmapped event logs and skips lookup entirely', async () => {
    await routeTemplateStatusEvent(
      singleChangeBody({ event: 'IN_APPEAL' }),
      'rest-1',
      log
    )

    expect(findByMetaTemplateId).not.toHaveBeenCalled()
    expect(findByNameAndLanguage).not.toHaveBeenCalled()
    expect(updateTemplate).not.toHaveBeenCalled()
    const unmapped = logs.find((l) => l[1] === 'webhook.template_status_unmapped')
    expect(unmapped?.[2]).toMatchObject({ event: 'IN_APPEAL' })
  })

  it('duplicate delivery: tryMarkProcessed returns duplicate, nothing else runs', async () => {
    vi.mocked(tryMarkProcessed).mockResolvedValue('duplicate')

    await routeTemplateStatusEvent(singleChangeBody({ event: 'APPROVED' }), 'rest-1', log)

    expect(findByMetaTemplateId).not.toHaveBeenCalled()
    expect(updateTemplate).not.toHaveBeenCalled()
  })

  it('idempotency claim error throws with the idempotency.error prefix', async () => {
    vi.mocked(tryMarkProcessed).mockResolvedValue('error')

    await expect(
      routeTemplateStatusEvent(singleChangeBody({ event: 'APPROVED' }), 'rest-1', log)
    ).rejects.toThrow(/^idempotency\.error/)

    expect(updateTemplate).not.toHaveBeenCalled()
  })

  it('batched payload: 2 entries -> 2 claims, 2 updates; one unknown template does not stop the other', async () => {
    vi.mocked(findByMetaTemplateId).mockImplementation(async (_restaurantId, metaTemplateId) => {
      if (metaTemplateId === '111') return templateFixture({ status: 'pending' })
      return null
    })

    const body = metaTemplateStatusBody([
      { metaTemplateId: 111, templateName: 'offer_promotion', event: 'APPROVED' },
      { metaTemplateId: 999, templateName: 'unknown_tpl', event: 'APPROVED' },
    ])

    await routeTemplateStatusEvent(body, 'rest-1', log)

    expect(tryMarkProcessed).toHaveBeenCalledTimes(2)
    expect(updateTemplate).toHaveBeenCalledTimes(1)
    expect(updateTemplate).toHaveBeenCalledWith('tpl-1', { status: 'approved' })
    const warned = logs.find((l) => l[1] === 'webhook.template_not_found')
    expect(warned).toBeDefined()
  })

  it('PAUSED event maps and applies per the write-guard', async () => {
    vi.mocked(findByMetaTemplateId).mockResolvedValue(
      templateFixture({ status: 'approved' })
    )

    await routeTemplateStatusEvent(singleChangeBody({ event: 'PAUSED' }), 'rest-1', log)

    expect(updateTemplate).toHaveBeenCalledWith('tpl-1', { status: 'paused' })
  })

  it('DISABLED event maps and applies per the write-guard', async () => {
    vi.mocked(findByMetaTemplateId).mockResolvedValue(
      templateFixture({ status: 'paused' })
    )

    await routeTemplateStatusEvent(singleChangeBody({ event: 'DISABLED' }), 'rest-1', log)

    expect(updateTemplate).toHaveBeenCalledWith('tpl-1', { status: 'disabled' })
  })
})
