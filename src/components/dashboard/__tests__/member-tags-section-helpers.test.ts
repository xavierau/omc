import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  memberTagsUrl,
  memberTagUrl,
  parseMemberTags,
  fetchMemberTags,
  assignMemberTags,
  removeMemberTag,
} from '@/components/dashboard/member-tags-section-helpers'

describe('member tag url builders', () => {
  it('builds the collection url for a member', () => {
    expect(memberTagsUrl('m1')).toBe('/api/dashboard/members/m1/tags')
  })
  it('builds the single-tag url for a member', () => {
    expect(memberTagUrl('m1', 't1')).toBe('/api/dashboard/members/m1/tags/t1')
  })
})

describe('parseMemberTags', () => {
  const tags = [{ id: 't1', name: 'VIP', color: '#fff' }]
  it('reads the { tags } envelope', () => {
    expect(parseMemberTags({ tags })).toEqual(tags)
  })
  it('reads a bare array', () => {
    expect(parseMemberTags(tags)).toEqual(tags)
  })
  it('falls back to [] for unexpected shapes', () => {
    expect(parseMemberTags(null)).toEqual([])
    expect(parseMemberTags({})).toEqual([])
    expect(parseMemberTags('nope')).toEqual([])
  })
})

describe('member tag fetch wiring', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('fetchMemberTags GETs the collection and returns tags', async () => {
    const tags = [{ id: 't1', name: 'VIP', color: '#fff' }]
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tags }) })
    vi.stubGlobal('fetch', fetchSpy)
    await expect(fetchMemberTags('m1')).resolves.toEqual(tags)
    expect(fetchSpy).toHaveBeenCalledWith('/api/dashboard/members/m1/tags')
  })

  it('fetchMemberTags throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    await expect(fetchMemberTags('m1')).rejects.toThrow()
  })

  it('assignMemberTags POSTs a { tagIds } body to the collection', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchSpy)
    await assignMemberTags('m1', ['t1', 't2'])
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/dashboard/members/m1/tags',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ tagIds: ['t1', 't2'] }),
      })
    )
  })

  it('assignMemberTags throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }))
    await expect(assignMemberTags('m1', ['t1'])).rejects.toThrow()
  })

  it('removeMemberTag DELETEs the single-tag url', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchSpy)
    await removeMemberTag('m1', 't1')
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/dashboard/members/m1/tags/t1',
      expect.objectContaining({ method: 'DELETE' })
    )
  })

  it('removeMemberTag throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    await expect(removeMemberTag('m1', 't1')).rejects.toThrow()
  })
})
