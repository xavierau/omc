// TAG-001 — Stream D: the import orchestrator applies the wizard's selected
// tags to every member created OR merged in a batch, via ONE bulk call after
// the fan-out. Mirrors the mocking style of import-contacts-batch.test.ts.

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

vi.mock('@/application/assign-tags-to-imported-members', () => ({
  assignTagsToImportedMembers: vi.fn(),
}))

import { importOneContactRow } from '@/application/import-contacts-batch-row'
import {
  insertImportBatch,
  updateImportBatchCounts,
} from '@/infrastructure/supabase/repositories/import-batch-repository'
import { assignTagsToImportedMembers } from '@/application/assign-tags-to-imported-members'
import type { ConsentGrade } from '@/domain/value-objects/consent-status'
import {
  importContactsBatch,
  type ImportContactsBatchInput,
} from '../import-contacts-batch'

const NOW = new Date('2026-05-04T12:00:00.000Z')

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(insertImportBatch).mockResolvedValue(undefined)
  vi.mocked(updateImportBatchCounts).mockResolvedValue(undefined)
  vi.mocked(assignTagsToImportedMembers).mockResolvedValue(undefined)
})

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
    tagIds: ['tag-1', 'tag-2'],
    now: NOW,
    ...overrides,
  }
}

function ok(
  memberId: string | null,
  created = true,
  gradeBucket: ConsentGrade = 'medium'
) {
  return { ok: true as const, gradeBucket, created, memberId }
}

describe('importContactsBatch — tag assignment (TAG-001 Stream D)', () => {
  it('assigns the selected tags to newly-created members (one bulk call)', async () => {
    vi.mocked(importOneContactRow)
      .mockResolvedValueOnce(ok('mem-1', true))
      .mockResolvedValueOnce(ok('mem-2', true))

    await importContactsBatch(buildInput({ tagIds: ['tag-1', 'tag-2'] }))

    expect(assignTagsToImportedMembers).toHaveBeenCalledTimes(1)
    expect(assignTagsToImportedMembers).toHaveBeenCalledWith({
      restaurantId: 'rest-1',
      memberIds: ['mem-1', 'mem-2'],
      tagIds: ['tag-1', 'tag-2'],
    })
  })

  it('assigns tags to MERGED members too (idempotency is the upsert\'s job)', async () => {
    vi.mocked(importOneContactRow)
      .mockResolvedValueOnce(ok('mem-existing-1', false))
      .mockResolvedValueOnce(ok('mem-existing-2', false))

    await importContactsBatch(
      buildInput({ mergeExistingMembers: true, tagIds: ['tag-1'] })
    )

    expect(assignTagsToImportedMembers).toHaveBeenCalledWith({
      restaurantId: 'rest-1',
      memberIds: ['mem-existing-1', 'mem-existing-2'],
      tagIds: ['tag-1'],
    })
  })

  it('does NOT call the tag assignment when tagIds is empty', async () => {
    vi.mocked(importOneContactRow).mockResolvedValue(ok('mem-1', true))

    await importContactsBatch(buildInput({ tagIds: [] }))

    expect(assignTagsToImportedMembers).not.toHaveBeenCalled()
  })

  it('tags a mixed batch of new AND merged members', async () => {
    vi.mocked(importOneContactRow)
      .mockResolvedValueOnce(ok('mem-new', true))
      .mockResolvedValueOnce(ok('mem-merged', false))

    await importContactsBatch(
      buildInput({ mergeExistingMembers: true, tagIds: ['tag-1'] })
    )

    expect(assignTagsToImportedMembers).toHaveBeenCalledWith({
      restaurantId: 'rest-1',
      memberIds: ['mem-new', 'mem-merged'],
      tagIds: ['tag-1'],
    })
  })

  it('filters out null memberId rows (consent-only) before assigning tags', async () => {
    vi.mocked(importOneContactRow)
      .mockResolvedValueOnce(ok(null, false)) // consent-only: no member resolved
      .mockResolvedValueOnce(ok('mem-2', true))

    await importContactsBatch(buildInput({ tagIds: ['tag-1'] }))

    expect(assignTagsToImportedMembers).toHaveBeenCalledWith({
      restaurantId: 'rest-1',
      memberIds: ['mem-2'],
      tagIds: ['tag-1'],
    })
  })

  it('does not carry rejected rows into the tagged member set', async () => {
    vi.mocked(importOneContactRow)
      .mockResolvedValueOnce(ok('mem-1', true))
      .mockResolvedValueOnce({
        ok: false,
        reject: { phoneE164: '+85299999999', reason: 'phone_already_member' },
      })

    await importContactsBatch(buildInput({ tagIds: ['tag-1'] }))

    expect(assignTagsToImportedMembers).toHaveBeenCalledWith({
      restaurantId: 'rest-1',
      memberIds: ['mem-1'],
      tagIds: ['tag-1'],
    })
  })
})
