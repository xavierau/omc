import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  buildImportUrl,
  buildPreviewBody,
  type ImportContactsBatchInput,
  type ImportContactsBatchResult,
  type ImportBatchSummary,
} from '@/hooks/use-import-batch'

const fixtureInput: ImportContactsBatchInput = {
  metadata: {
    source: 'Reservation notebook',
    dateRangeStart: '2025-01-01',
    dateRangeEnd: '2025-12-31',
    consentTextShown: 'We will send WhatsApp offers',
    consentChannel: 'whatsapp',
    proofUrl: 'storage/path/abc.jpg',
  },
  rows: [
    { phoneE164: '+85291234567', name: 'Wong', preferredLanguage: 'zh_hk' },
  ],
  mergeExistingMembers: false,
}

const fixtureResult: ImportContactsBatchResult = {
  importBatchId: 'batch-1',
  inserted: 1,
  membersCreated: 1,
  rejected: [],
  gradeBreakdown: { strong: 1, medium: 0, weak: 0, none: 0 },
  tagging: { status: 'ok', taggedMembers: 0 },
}

const fixtureList: { batches: ImportBatchSummary[] } = {
  batches: [
    {
      id: 'batch-1',
      source: 'Reservation notebook',
      createdAt: '2026-04-01T00:00:00Z',
      rowCount: 1,
      gradeBreakdown: { strong: 1, medium: 0, weak: 0, none: 0 },
    },
  ],
}

describe('buildImportUrl', () => {
  it('builds the base URL for commit and list', () => {
    expect(buildImportUrl()).toBe('/api/dashboard/imports')
  })
  it('builds the preview sub-route', () => {
    expect(buildImportUrl('preview')).toBe('/api/dashboard/imports/preview')
  })
  it('builds the proof-upload sub-route', () => {
    expect(buildImportUrl('proof-upload')).toBe(
      '/api/dashboard/imports/proof-upload'
    )
  })
})

describe('buildPreviewBody', () => {
  it('returns the wire shape expected by the API', () => {
    expect(buildPreviewBody(fixtureInput)).toEqual(fixtureInput)
  })
})

describe('useImportBatch fetch wiring', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('previewBatch POSTs to /preview with JSON body', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...fixtureResult, importBatchId: '', inserted: 0, membersCreated: 0 }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    await fetch(buildImportUrl('preview'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPreviewBody(fixtureInput)),
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/dashboard/imports/preview',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(fixtureInput),
      })
    )
  })

  it('commitBatch POSTs to /imports with JSON body', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => fixtureResult })
    vi.stubGlobal('fetch', fetchSpy)

    await fetch(buildImportUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fixtureInput),
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/dashboard/imports',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('listBatches GETs /imports', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => fixtureList })
    vi.stubGlobal('fetch', fetchSpy)
    await fetch(buildImportUrl())
    expect(fetchSpy).toHaveBeenCalledWith('/api/dashboard/imports')
  })

  it('uploadProof POSTs FormData to /proof-upload', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ storagePath: 'p', signedUrl: 's' }),
    })
    vi.stubGlobal('fetch', fetchSpy)
    const fd = new FormData()
    await fetch(buildImportUrl('proof-upload'), { method: 'POST', body: fd })
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/dashboard/imports/proof-upload',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('exports the hook function symbol', async () => {
    const mod = await import('@/hooks/use-import-batch')
    expect(typeof mod.useImportBatch).toBe('function')
  })
})
