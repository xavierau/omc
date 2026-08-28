import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/application/import-contacts-batch-row', () => ({
  importOneContactRow: vi.fn(),
}))

vi.mock('@/infrastructure/supabase/repositories/import-batch-repository', () => ({
  insertImportBatch: vi.fn(),
  updateImportBatchCounts: vi.fn(),
  importBatchRepository: {
    insertBatch: vi.fn(),
    updateBatchCounts: vi.fn(),
    findByRestaurant: vi.fn(),
  },
}))

import { importOneContactRow } from '@/application/import-contacts-batch-row'
import {
  insertImportBatch,
  updateImportBatchCounts,
} from '@/infrastructure/supabase/repositories/import-batch-repository'
import {
  importContactsBatch,
  type ImportContactsBatchInput,
} from '../import-contacts-batch'

const NOW = new Date('2026-05-04T12:00:00.000Z')

beforeEach(() => vi.clearAllMocks())

function buildInput(
  overrides: Partial<ImportContactsBatchInput> = {}
): ImportContactsBatchInput {
  return {
    restaurantId: 'rest-1',
    createdBy: 'auth-user-1',
    metadata: {
      source: 'paper-list-2026-Q1',
      dateRangeStart: new Date('2025-11-01T00:00:00.000Z'),
      dateRangeEnd: new Date('2026-01-31T00:00:00.000Z'),
      consentTextShown: 'I agree to receive marketing messages from Demo Cafe.',
      consentChannel: 'generic',
      proofUrl: null,
    },
    rows: [
      { phoneE164: '+85291234567' },
      { phoneE164: '+85299999999' },
    ],
    mergeExistingMembers: false,
    tagIds: [],
    now: NOW,
    ...overrides,
  }
}

describe('importContactsBatch', () => {
  it('happy path — inserts placeholder batch first, fans out, then updates counts (B5)', async () => {
    const calls: string[] = []
    vi.mocked(insertImportBatch).mockImplementation(async () => {
      calls.push('insertImportBatch')
    })
    vi.mocked(importOneContactRow).mockImplementation(async () => {
      calls.push('importOneContactRow')
      return { ok: true, gradeBucket: 'medium', created: true, memberId: 'mem-1' }
    })
    vi.mocked(updateImportBatchCounts).mockImplementation(async () => {
      calls.push('updateImportBatchCounts')
    })

    const result = await importContactsBatch(buildInput())

    expect(result.inserted).toBe(2)
    expect(result.membersCreated).toBe(2)
    expect(result.rejected).toEqual([])
    expect(result.gradeBreakdown).toEqual({ strong: 0, medium: 2, weak: 0, none: 0 })

    // Strict ordering: placeholder batch row inserted BEFORE any per-row work.
    expect(calls).toEqual([
      'insertImportBatch',
      'importOneContactRow',
      'importOneContactRow',
      'updateImportBatchCounts',
    ])

    // Placeholder row has zero counts — real counts arrive via update.
    const placeholder = vi.mocked(insertImportBatch).mock.calls[0][0]
    expect(placeholder.snapshot.rowCount).toBe(0)
    expect(placeholder.snapshot.mediumCount).toBe(0)
    expect(placeholder.snapshot.id).toBe(result.importBatchId)

    // Update is targeted at the same id with real counts.
    expect(updateImportBatchCounts).toHaveBeenCalledWith(result.importBatchId, {
      rowCount: 2,
      gradeBreakdown: { strong: 0, medium: 2, weak: 0, none: 0 },
    })
  })

  it('survives a thrown row error mid-batch — batch + remaining rows still committed (B5)', async () => {
    vi.mocked(insertImportBatch).mockResolvedValue(undefined)
    vi.mocked(updateImportBatchCounts).mockResolvedValue(undefined)
    // Row 2 of 3 throws (e.g. emitEvent failure). Rows 1 + 3 succeed.
    vi.mocked(importOneContactRow)
      .mockResolvedValueOnce({ ok: true, gradeBucket: 'medium', created: true, memberId: 'mem-1' })
      .mockRejectedValueOnce(new Error('emitEvent boom'))
      .mockResolvedValueOnce({ ok: true, gradeBucket: 'medium', created: true, memberId: 'mem-1' })

    const result = await importContactsBatch(
      buildInput({
        rows: [
          { phoneE164: '+85291111111' },
          { phoneE164: '+85292222222' },
          { phoneE164: '+85293333333' },
        ],
      })
    )

    // 2 of 3 rows committed. The thrown one converts to a rejected entry
    // (we treat it as duplicate_active since the consent insert failed mid-flight)
    // — but the batch row itself is still patched with the real count.
    expect(result.inserted).toBe(2)
    expect(result.rejected.length).toBeGreaterThanOrEqual(1)
    expect(insertImportBatch).toHaveBeenCalledTimes(1) // placeholder still inserted
    expect(updateImportBatchCounts).toHaveBeenCalledWith(result.importBatchId, {
      rowCount: 2,
      gradeBreakdown: { strong: 0, medium: 2, weak: 0, none: 0 },
    })
  })

  it('returns metadata error without writes when whatsapp proof missing', async () => {
    const input = buildInput()
    input.metadata.consentChannel = 'whatsapp'
    input.metadata.proofUrl = null

    await expect(importContactsBatch(input)).rejects.toThrow(
      /whatsapp_proof_required/
    )
    expect(importOneContactRow).not.toHaveBeenCalled()
    expect(insertImportBatch).not.toHaveBeenCalled()
  })

  it('rejects duplicate phones within the batch (kept out of fan-out)', async () => {
    vi.mocked(importOneContactRow).mockResolvedValue({ ok: true, gradeBucket: 'medium', created: true, memberId: 'mem-1' })
    vi.mocked(insertImportBatch).mockResolvedValue(undefined)
    vi.mocked(updateImportBatchCounts).mockResolvedValue(undefined)

    const result = await importContactsBatch(
      buildInput({
        rows: [
          { phoneE164: '+85291234567' },
          { phoneE164: '85291234567' },          // dup after normalisation
          { phoneE164: '+85299999999' },
        ],
      })
    )

    expect(result.rejected.some((r) => r.reason === 'duplicate_phone_in_batch')).toBe(true)
    expect(importOneContactRow).toHaveBeenCalledTimes(2)
  })

  it('counts gradeBreakdown across mixed grades', async () => {
    vi.mocked(importOneContactRow)
      .mockResolvedValueOnce({ ok: true, gradeBucket: 'strong', created: true, memberId: 'mem-strong' })
      .mockResolvedValueOnce({ ok: true, gradeBucket: 'weak', created: true, memberId: 'mem-weak' })
    vi.mocked(insertImportBatch).mockResolvedValue(undefined)
    vi.mocked(updateImportBatchCounts).mockResolvedValue(undefined)

    const result = await importContactsBatch(buildInput())

    expect(result.gradeBreakdown.strong).toBe(1)
    expect(result.gradeBreakdown.weak).toBe(1)
  })

  it('reports per-row rejections without throwing', async () => {
    vi.mocked(importOneContactRow)
      .mockResolvedValueOnce({ ok: true, gradeBucket: 'medium', created: true, memberId: 'mem-1' })
      .mockResolvedValueOnce({
        ok: false,
        reject: { phoneE164: '+85299999999', reason: 'phone_already_member' },
      })
    vi.mocked(insertImportBatch).mockResolvedValue(undefined)
    vi.mocked(updateImportBatchCounts).mockResolvedValue(undefined)

    const result = await importContactsBatch(buildInput())

    expect(result.inserted).toBe(1)
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0].reason).toBe('phone_already_member')
  })

  it('membersCreated counts only created=true rows (B3, merge=true)', async () => {
    vi.mocked(importOneContactRow)
      .mockResolvedValueOnce({ ok: true, gradeBucket: 'medium', created: true, memberId: 'mem-1' })
      .mockResolvedValueOnce({ ok: true, gradeBucket: 'medium', created: false, memberId: 'mem-existing' })
    vi.mocked(insertImportBatch).mockResolvedValue(undefined)
    vi.mocked(updateImportBatchCounts).mockResolvedValue(undefined)

    const result = await importContactsBatch(
      buildInput({ mergeExistingMembers: true })
    )

    expect(result.inserted).toBe(2)
    expect(result.membersCreated).toBe(1) // only the created=true row counts
  })

  it('rejects empty rows[] with empty_rows reason (B2 — AC #5)', async () => {
    const input = buildInput({ rows: [] })
    await expect(importContactsBatch(input)).rejects.toMatchObject({
      name: 'ImportBatchValidationError',
      reason: 'empty_rows',
    })
    expect(importOneContactRow).not.toHaveBeenCalled()
    expect(insertImportBatch).not.toHaveBeenCalled()
  })

  it('concurrent calls produce two distinct batch rows (different ids)', async () => {
    vi.mocked(importOneContactRow).mockResolvedValue({ ok: true, gradeBucket: 'medium', created: true, memberId: 'mem-1' })
    vi.mocked(insertImportBatch).mockResolvedValue(undefined)
    vi.mocked(updateImportBatchCounts).mockResolvedValue(undefined)

    const [r1, r2] = await Promise.all([
      importContactsBatch(buildInput()),
      importContactsBatch(buildInput()),
    ])

    expect(r1.importBatchId).not.toBe(r2.importBatchId)
    expect(insertImportBatch).toHaveBeenCalledTimes(2)
  })
})
