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

vi.mock('@/application/assign-row-tags-to-imported-members', () => ({
  assignRowTagsToImportedMembers: vi.fn(),
}))

vi.mock('@/infrastructure/supabase/repositories/tag-repository', () => ({
  tagRepository: { listByRestaurant: vi.fn() },
}))

import { importOneContactRow } from '@/application/import-contacts-batch-row'
import {
  insertImportBatch,
  updateImportBatchCounts,
} from '@/infrastructure/supabase/repositories/import-batch-repository'
import { assignTagsToImportedMembers } from '@/application/assign-tags-to-imported-members'
import { assignRowTagsToImportedMembers } from '@/application/assign-row-tags-to-imported-members'
import { tagRepository } from '@/infrastructure/supabase/repositories/tag-repository'
import type { ConsentGrade } from '@/domain/value-objects/consent-status'
import {
  importContactsBatch,
  type ImportContactsBatchInput,
} from '../import-contacts-batch'
import { MAX_NEW_TAGS_PER_IMPORT } from '../import-contacts-batch-tags'

const NOW = new Date('2026-05-04T12:00:00.000Z')

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(insertImportBatch).mockResolvedValue(undefined)
  vi.mocked(updateImportBatchCounts).mockResolvedValue(undefined)
  vi.mocked(assignTagsToImportedMembers).mockResolvedValue(undefined)
  vi.mocked(assignRowTagsToImportedMembers).mockResolvedValue({ taggedMembers: 0 })
  vi.mocked(tagRepository.listByRestaurant).mockResolvedValue([])
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

// ---------------------------------------------------------------------------
// TAG-001 B2 — per-row CSV tags (plan T-B2.*, as amended by AM-1/AM-2)
// ---------------------------------------------------------------------------

function tenantTag(name: string) {
  return {
    id: `t-${name.toLowerCase()}`,
    restaurantId: 'rest-1',
    name,
    color: '#6B7280',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function newTagNames(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `tag-${i}`)
}

/** MAX_TAGS_PER_ROW is 10, so a wide tag set has to span several rows. */
function rowsCarrying(names: string[]) {
  const rows: Array<{ phoneE164: string; tags: string[] }> = []
  for (let i = 0; i < names.length; i += 10) {
    rows.push({
      phoneE164: `+8529${String(1000000 + rows.length).slice(-7)}`,
      tags: names.slice(i, i + 10),
    })
  }
  return rows
}

describe('importContactsBatch — per-row CSV tags (TAG-001 B2)', () => {
  // T-B2.1 + T-B2.3: newly created AND merged members both carry their row tags.
  it('pairs each accepted row with the member id the consent path produced', async () => {
    vi.mocked(importOneContactRow)
      .mockResolvedValueOnce(ok('mem-new', true))
      .mockResolvedValueOnce(ok('mem-merged', false))

    await importContactsBatch(
      buildInput({
        tagIds: [],
        mergeExistingMembers: true,
        rows: [
          { phoneE164: '+85291234567', tags: ['VIP'] },
          { phoneE164: '+85299999999', tags: ['VIP', 'Lunch'] },
        ],
      })
    )

    expect(assignRowTagsToImportedMembers).toHaveBeenCalledWith({
      restaurantId: 'rest-1',
      rows: [
        { memberId: 'mem-new', tagNames: ['VIP'] },
        { memberId: 'mem-merged', tagNames: ['VIP', 'Lunch'] },
      ],
    })
  })

  // T-B2.6: rejected by resolveMemberId (23505, merge OFF).
  it('never tags a row rejected as phone_already_member', async () => {
    vi.mocked(importOneContactRow)
      .mockResolvedValueOnce(ok('mem-1', true))
      .mockResolvedValueOnce({
        ok: false,
        reject: { phoneE164: '+85299999999', reason: 'phone_already_member' },
      })

    await importContactsBatch(
      buildInput({
        tagIds: [],
        rows: [
          { phoneE164: '+85291234567', tags: ['VIP'] },
          { phoneE164: '+85299999999', tags: ['Lunch'] },
        ],
      })
    )

    expect(assignRowTagsToImportedMembers).toHaveBeenCalledWith({
      restaurantId: 'rest-1',
      rows: [{ memberId: 'mem-1', tagNames: ['VIP'] }],
    })
  })

  // T-B2.7: rejected by insertConsentRecord.
  it('never tags a row rejected as duplicate_active', async () => {
    vi.mocked(importOneContactRow)
      .mockResolvedValueOnce({
        ok: false,
        reject: { phoneE164: '+85291234567', reason: 'duplicate_active' },
      })
      .mockResolvedValueOnce(ok('mem-2', true))

    await importContactsBatch(
      buildInput({
        tagIds: [],
        rows: [
          { phoneE164: '+85291234567', tags: ['VIP'] },
          { phoneE164: '+85299999999', tags: ['Lunch'] },
        ],
      })
    )

    expect(assignRowTagsToImportedMembers).toHaveBeenCalledWith({
      restaurantId: 'rest-1',
      rows: [{ memberId: 'mem-2', tagNames: ['Lunch'] }],
    })
  })

  it('never tags a consent-only row (null memberId)', async () => {
    vi.mocked(importOneContactRow)
      .mockResolvedValueOnce(ok(null, false))
      .mockResolvedValueOnce(ok('mem-2', true))

    await importContactsBatch(
      buildInput({
        tagIds: [],
        rows: [
          { phoneE164: '+85291234567', tags: ['VIP'] },
          { phoneE164: '+85299999999', tags: ['Lunch'] },
        ],
      })
    )

    expect(assignRowTagsToImportedMembers).toHaveBeenCalledWith({
      restaurantId: 'rest-1',
      rows: [{ memberId: 'mem-2', tagNames: ['Lunch'] }],
    })
  })

  it('does not call the per-row use case when no row carries a tag', async () => {
    vi.mocked(importOneContactRow).mockResolvedValue(ok('mem-1', true))

    await importContactsBatch(buildInput({ tagIds: [] }))

    expect(assignRowTagsToImportedMembers).not.toHaveBeenCalled()
    expect(tagRepository.listByRestaurant).not.toHaveBeenCalled()
  })

  // T-B2.10: batch-level ids and per-row names are independent, additive paths.
  it('applies batch-level tag ids AND per-row tag names, batch-level first', async () => {
    const order: string[] = []
    vi.mocked(importOneContactRow).mockResolvedValue(ok('mem-1', true))
    vi.mocked(assignTagsToImportedMembers).mockImplementation(async () => {
      order.push('batch')
    })
    vi.mocked(assignRowTagsToImportedMembers).mockImplementation(async () => {
      order.push('row')
      return { taggedMembers: 1 }
    })

    await importContactsBatch(
      buildInput({
        tagIds: ['tag-1'],
        rows: [{ phoneE164: '+85291234567', tags: ['VIP'] }],
      })
    )

    expect(order).toEqual(['batch', 'row'])
    expect(assignTagsToImportedMembers).toHaveBeenCalledWith({
      restaurantId: 'rest-1',
      memberIds: ['mem-1'],
      tagIds: ['tag-1'],
    })
    expect(assignRowTagsToImportedMembers).toHaveBeenCalledWith({
      restaurantId: 'rest-1',
      rows: [{ memberId: 'mem-1', tagNames: ['VIP'] }],
    })
  })

  // Invariant 3: the whole tag phase runs strictly AFTER the consent fan-out.
  it('runs the tag phase only after fan-out and the batch count update', async () => {
    const order: string[] = []
    vi.mocked(importOneContactRow).mockImplementation(async () => {
      order.push('row')
      return ok('mem-1', true)
    })
    vi.mocked(updateImportBatchCounts).mockImplementation(async () => {
      order.push('counts')
    })
    vi.mocked(assignRowTagsToImportedMembers).mockImplementation(async () => {
      order.push('tags')
      return { taggedMembers: 1 }
    })

    await importContactsBatch(
      buildInput({
        tagIds: [],
        rows: [{ phoneE164: '+85291234567', tags: ['VIP'] }],
      })
    )

    expect(order).toEqual(['row', 'counts', 'tags'])
  })
})

describe('importContactsBatch — new-tag cap (AM-1, T-B2.8)', () => {
  it('rejects 51 distinct NEW names before any write', async () => {
    vi.mocked(importOneContactRow).mockResolvedValue(ok('mem-1', true))

    await expect(
      importContactsBatch(
        buildInput({
          tagIds: [],
          rows: rowsCarrying(newTagNames(51)),
        })
      )
    ).rejects.toMatchObject({
      name: 'ImportBatchValidationError',
      reason: 'too_many_new_tags',
    })

    expect(insertImportBatch).not.toHaveBeenCalled()
    expect(importOneContactRow).not.toHaveBeenCalled()
    expect(updateImportBatchCounts).not.toHaveBeenCalled()
    expect(assignRowTagsToImportedMembers).not.toHaveBeenCalled()
  })

  it('says the contacts were NOT imported in the error message', async () => {
    await expect(
      importContactsBatch(
        buildInput({
          tagIds: [],
          rows: rowsCarrying(newTagNames(51)),
        })
      )
    ).rejects.toThrow(/no contacts were imported/i)
  })

  it('accepts exactly MAX_NEW_TAGS_PER_IMPORT new names', async () => {
    vi.mocked(importOneContactRow).mockResolvedValue(ok('mem-1', true))

    const result = await importContactsBatch(
      buildInput({
        tagIds: [],
        rows: rowsCarrying(newTagNames(MAX_NEW_TAGS_PER_IMPORT)),
      })
    )

    expect(result.inserted).toBe(5)
    expect(insertImportBatch).toHaveBeenCalledTimes(1)
  })

  // Only names the tenant does NOT already have count against the cap, matched
  // case-insensitively via tagKey.
  it('counts only names the tenant does not already have (case-insensitive)', async () => {
    vi.mocked(importOneContactRow).mockResolvedValue(ok('mem-1', true))
    vi.mocked(tagRepository.listByRestaurant).mockResolvedValue(
      newTagNames(51).map((n) => tenantTag(n.toUpperCase()))
    )

    const result = await importContactsBatch(
      buildInput({
        tagIds: [],
        rows: rowsCarrying(newTagNames(51)),
      })
    )

    expect(result.inserted).toBe(6)
    expect(tagRepository.listByRestaurant).toHaveBeenCalledWith('rest-1')
  })

  it('counts distinct keys across rows, not per-row totals', async () => {
    vi.mocked(importOneContactRow).mockResolvedValue(ok('mem-1', true))

    const result = await importContactsBatch(
      buildInput({
        tagIds: [],
        rows: [
          { phoneE164: '+85291234567', tags: ['VIP'] },
          { phoneE164: '+85299999999', tags: ['vip'] },
          { phoneE164: '+85293333333', tags: ['ViP'] },
        ],
      })
    )

    expect(result.inserted).toBe(3)
    expect(tagRepository.listByRestaurant).toHaveBeenCalledTimes(1)
  })
})

describe('importContactsBatch — tag phase is best-effort (AM-1)', () => {
  it('reports tagging ok with the tagged member count', async () => {
    vi.mocked(importOneContactRow).mockResolvedValue(ok('mem-1', true))
    vi.mocked(assignRowTagsToImportedMembers).mockResolvedValue({ taggedMembers: 1 })

    const result = await importContactsBatch(
      buildInput({
        tagIds: [],
        rows: [{ phoneE164: '+85291234567', tags: ['VIP'] }],
      })
    )

    expect(result.tagging).toEqual({ status: 'ok', taggedMembers: 1 })
  })

  it('reports tagging ok with zero tagged members when no tag was requested', async () => {
    vi.mocked(importOneContactRow).mockResolvedValue(ok('mem-1', true))

    const result = await importContactsBatch(buildInput({ tagIds: [] }))

    expect(result.tagging).toEqual({ status: 'ok', taggedMembers: 0 })
  })

  it('counts batch-level tagged members when only batch tags were selected', async () => {
    vi.mocked(importOneContactRow)
      .mockResolvedValueOnce(ok('mem-1', true))
      .mockResolvedValueOnce(ok('mem-2', true))

    const result = await importContactsBatch(buildInput({ tagIds: ['tag-1'] }))

    expect(result.tagging).toEqual({ status: 'ok', taggedMembers: 2 })
  })

  it('survives a per-row tag failure — consent result intact, tagging failed', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(importOneContactRow).mockResolvedValue(ok('mem-1', true))
    vi.mocked(assignRowTagsToImportedMembers).mockRejectedValue(new Error('rpc down'))

    const result = await importContactsBatch(
      buildInput({
        tagIds: [],
        rows: [{ phoneE164: '+85291234567', tags: ['VIP'] }],
      })
    )

    expect(result.inserted).toBe(1)
    expect(result.membersCreated).toBe(1)
    expect(result.rejected).toEqual([])
    expect(result.tagging).toEqual({ status: 'failed', taggedMembers: 0 })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('survives a batch-level tag failure the same way', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(importOneContactRow).mockResolvedValue(ok('mem-1', true))
    vi.mocked(assignTagsToImportedMembers).mockRejectedValue(
      new Error('CrossTenantTagError')
    )

    const result = await importContactsBatch(buildInput({ tagIds: ['tag-1'] }))

    expect(result.inserted).toBe(2)
    expect(result.tagging).toEqual({ status: 'failed', taggedMembers: 0 })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('does not run the per-row use case when the batch-level path throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(importOneContactRow).mockResolvedValue(ok('mem-1', true))
    vi.mocked(assignTagsToImportedMembers).mockRejectedValue(new Error('boom'))

    await importContactsBatch(
      buildInput({
        tagIds: ['tag-1'],
        rows: [{ phoneE164: '+85291234567', tags: ['VIP'] }],
      })
    )

    expect(assignRowTagsToImportedMembers).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
