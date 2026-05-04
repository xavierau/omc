import { describe, it, expect, vi } from 'vitest'

vi.mock('@/infrastructure/kapso/template-client', () => ({
  createMetaTemplate: vi.fn(),
  listMetaTemplates: vi.fn(),
  getMetaTemplate: vi.fn(),
  deleteMetaTemplate: vi.fn(),
  resolveWabaId: vi.fn(),
  sendTemplateMessage: vi.fn(),
}))

import { kapsoTemplateAdapter } from '../template-adapter'
import {
  createMetaTemplate,
  listMetaTemplates,
  getMetaTemplate,
  deleteMetaTemplate,
  resolveWabaId,
  sendTemplateMessage,
} from '@/infrastructure/kapso/template-client'
import type { WhatsAppTemplatePort } from '@/domain/ports/whatsapp-templates'
import { okResult } from '@/test-utils/send-result'

describe('kapsoTemplateAdapter', () => {
  it('satisfies WhatsAppTemplatePort interface', () => {
    const port: WhatsAppTemplatePort = kapsoTemplateAdapter
    expect(port).toBeDefined()
  })

  it('createTemplate maps result to { id, status }', async () => {
    vi.mocked(createMetaTemplate).mockResolvedValue({ id: 't1', status: 'APPROVED', category: 'MARKETING' } as never)
    const result = await kapsoTemplateAdapter.createTemplate('waba1', {
      name: 'tpl', language: 'en', category: 'MARKETING', components: [],
    })
    expect(result).toEqual({ id: 't1', status: 'APPROVED' })
  })

  it('createTemplate returns null when underlying returns null', async () => {
    vi.mocked(createMetaTemplate).mockResolvedValue(null as never)
    const result = await kapsoTemplateAdapter.createTemplate('waba1', {
      name: 'tpl', language: 'en', category: 'MARKETING', components: [],
    })
    expect(result).toBeNull()
  })

  it('listTemplates maps to TemplateListItem[]', async () => {
    vi.mocked(listMetaTemplates).mockResolvedValue([
      { id: 't1', name: 'tpl1', status: 'APPROVED', extra: true },
    ] as never)
    const result = await kapsoTemplateAdapter.listTemplates('waba1')
    expect(result).toEqual([{ id: 't1', name: 'tpl1', status: 'APPROVED', extra: true }])
  })

  it('listTemplates returns null when underlying returns null', async () => {
    vi.mocked(listMetaTemplates).mockResolvedValue(null as never)
    expect(await kapsoTemplateAdapter.listTemplates('waba1')).toBeNull()
  })

  it('delegates getTemplate', async () => {
    vi.mocked(getMetaTemplate).mockResolvedValue({ id: 't1', name: 'x' } as never)
    const result = await kapsoTemplateAdapter.getTemplate('waba1', 't1')
    expect(result).toEqual({ id: 't1', name: 'x' })
  })

  it('delegates deleteTemplate', async () => {
    vi.mocked(deleteMetaTemplate).mockResolvedValue(true)
    expect(await kapsoTemplateAdapter.deleteTemplate('waba1', 'tpl')).toBe(true)
    expect(deleteMetaTemplate).toHaveBeenCalledWith('waba1', 'tpl')
  })

  it('delegates resolveWabaId', async () => {
    vi.mocked(resolveWabaId).mockResolvedValue('waba-123')
    expect(await kapsoTemplateAdapter.resolveWabaId('phone1')).toBe('waba-123')
  })

  it('delegates sendTemplate', async () => {
    const ok = okResult('wamid.tpl')
    vi.mocked(sendTemplateMessage).mockResolvedValue(ok)
    const params = { templateName: 'tpl', language: 'en' }
    expect(await kapsoTemplateAdapter.sendTemplate('phone1', '+1234', params)).toEqual(ok)
    expect(sendTemplateMessage).toHaveBeenCalledWith('phone1', '+1234', params)
  })
})
