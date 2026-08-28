import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  bulkUpdateMemberTags,
  joinTagNames,
  MAX_BULK_MEMBERS,
  MAX_BULK_TAGS,
} from '@/components/dashboard/member-bulk-tag-helpers'

const manyIds = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`)

describe('bulkUpdateMemberTags', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('posts memberIds/tagIds/action to the bulk-tags endpoint', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ affected: 3 }), { status: 200 }) as never)

    await bulkUpdateMemberTags({ memberIds: ['m1', 'm2'], tagIds: ['t1'], action: 'add' })

    expect(fetchMock).toHaveBeenCalledWith('/api/dashboard/members/bulk-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberIds: ['m1', 'm2'], tagIds: ['t1'], action: 'add' }),
    })
  })

  it('resolves ok with the affected count on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ affected: 5 }), { status: 200 }) as never
    )

    const result = await bulkUpdateMemberTags({ memberIds: ['m1'], tagIds: ['t1'], action: 'remove' })

    expect(result).toEqual({ ok: true, affected: 5 })
  })

  it('defaults affected to 0 when the body is missing or malformed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not json', { status: 200 }) as never)

    const result = await bulkUpdateMemberTags({ memberIds: ['m1'], tagIds: ['t1'], action: 'add' })

    expect(result).toEqual({ ok: true, affected: 0 })
  })

  it('maps a 403 response to bulkTagForbidden', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Invalid member IDs' }), { status: 403 }) as never
    )

    const result = await bulkUpdateMemberTags({ memberIds: ['m1'], tagIds: ['t1'], action: 'add' })

    expect(result).toEqual({ ok: false, errorKey: 'bulkTagForbidden' })
  })

  it('maps a 400 response to bulkTagFailed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 400 }) as never)

    const result = await bulkUpdateMemberTags({ memberIds: ['m1'], tagIds: ['t1'], action: 'add' })

    expect(result).toEqual({ ok: false, errorKey: 'bulkTagFailed' })
  })

  it('maps a 500 response to bulkTagFailed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 500 }) as never)

    const result = await bulkUpdateMemberTags({ memberIds: ['m1'], tagIds: ['t1'], action: 'add' })

    expect(result).toEqual({ ok: false, errorKey: 'bulkTagFailed' })
  })

  it('maps a network error (fetch rejects) to bulkTagFailed', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'))

    const result = await bulkUpdateMemberTags({ memberIds: ['m1'], tagIds: ['t1'], action: 'add' })

    expect(result).toEqual({ ok: false, errorKey: 'bulkTagFailed' })
  })

  it('rejects client-side when memberIds exceeds the cap, without calling fetch', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    const result = await bulkUpdateMemberTags({
      memberIds: manyIds(MAX_BULK_MEMBERS + 1),
      tagIds: ['t1'],
      action: 'add',
    })

    expect(result).toEqual({ ok: false, errorKey: 'bulkTagTooMany' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects client-side when tagIds exceeds the cap, without calling fetch', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    const result = await bulkUpdateMemberTags({
      memberIds: ['m1'],
      tagIds: manyIds(MAX_BULK_TAGS + 1),
      action: 'remove',
    })

    expect(result).toEqual({ ok: false, errorKey: 'bulkTagTooMany' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts exactly the cap (500 members, 20 tags)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ affected: 1 }), { status: 200 }) as never
    )

    const result = await bulkUpdateMemberTags({
      memberIds: manyIds(MAX_BULK_MEMBERS),
      tagIds: manyIds(MAX_BULK_TAGS),
      action: 'add',
    })

    expect(result.ok).toBe(true)
  })
})

describe('joinTagNames', () => {
  const tags = [
    { id: 't1', name: 'VIP' },
    { id: 't2', name: 'Lunch' },
  ]

  it('joins matched tag names in selection order', () => {
    expect(joinTagNames(['t1', 't2'], tags)).toBe('VIP, Lunch')
  })

  it('skips ids with no match', () => {
    expect(joinTagNames(['t1', 'missing'], tags)).toBe('VIP')
  })

  it('returns an empty string for an empty selection', () => {
    expect(joinTagNames([], tags)).toBe('')
  })
})
