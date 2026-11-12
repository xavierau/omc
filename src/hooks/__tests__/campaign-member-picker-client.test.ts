import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  buildMemberSearchUrl,
  fetchMemberPage,
  PICKER_PAGE_SIZE,
} from '@/hooks/campaign-member-picker-client'

describe('buildMemberSearchUrl', () => {
  it('builds the base URL with page and pageSize, no search param when empty', () => {
    expect(buildMemberSearchUrl({ search: '', page: 1, pageSize: 200 })).toBe(
      '/api/dashboard/members?page=1&pageSize=200'
    )
  })

  it('includes a trimmed search term', () => {
    expect(buildMemberSearchUrl({ search: '  wong  ', page: 1, pageSize: 200 })).toBe(
      '/api/dashboard/members?page=1&pageSize=200&search=wong'
    )
  })

  it('omits the search param for a whitespace-only term', () => {
    expect(buildMemberSearchUrl({ search: '   ', page: 1, pageSize: 200 })).toBe(
      '/api/dashboard/members?page=1&pageSize=200'
    )
  })

  it('carries the requested page number', () => {
    expect(buildMemberSearchUrl({ search: '', page: 3, pageSize: 200 })).toBe(
      '/api/dashboard/members?page=3&pageSize=200'
    )
  })
})

describe('fetchMemberPage', () => {
  beforeEach(() => vi.resetAllMocks())

  it('GETs the search URL and normalizes the response shape', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        members: [{ id: 'm-1', name: 'Wong', phone: '+85291234567' }],
        total: 43,
        page: 1,
        totalPages: 1,
      }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await fetchMemberPage({ search: 'wong', page: 1, pageSize: PICKER_PAGE_SIZE })

    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/dashboard/members?page=1&pageSize=${PICKER_PAGE_SIZE}&search=wong`
    )
    expect(result).toEqual({
      members: [{ id: 'm-1', name: 'Wong', phone: '+85291234567' }],
      total: 43,
      page: 1,
      totalPages: 1,
    })
  })

  it('throws when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))

    await expect(
      fetchMemberPage({ search: '', page: 1, pageSize: PICKER_PAGE_SIZE })
    ).rejects.toThrow()
  })

  it('defaults total/totalPages when the API omits them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ members: [] }) }))

    const result = await fetchMemberPage({ search: '', page: 1, pageSize: PICKER_PAGE_SIZE })

    expect(result).toEqual({ members: [], total: 0, page: 1, totalPages: 1 })
  })
})
