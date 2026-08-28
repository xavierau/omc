import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  fetchTags,
  createTagRequest,
  renameTagRequest,
  deleteTagRequest,
} from '@/hooks/tag-client'

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

const TAG = { id: 't-1', restaurantId: 'r-1', name: 'VIP', color: '#6B7280', createdAt: 'x' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchTags', () => {
  it('returns the tags array from the { tags } envelope', async () => {
    mockFetch(200, { tags: [TAG] })
    await expect(fetchTags()).resolves.toEqual([TAG])
  })

  it('returns [] when the response is not ok', async () => {
    mockFetch(500, { error: 'boom' })
    await expect(fetchTags()).resolves.toEqual([])
  })

  it('returns [] when the body has no tags array', async () => {
    mockFetch(200, {})
    await expect(fetchTags()).resolves.toEqual([])
  })
})

describe('createTagRequest', () => {
  it('POSTs the name and returns the created tag on 201', async () => {
    const fetchMock = mockFetch(201, TAG)
    const result = await createTagRequest('VIP')
    expect(result).toEqual({ ok: true, tag: TAG })
    const [, init] = fetchMock.mock.calls[0]
    expect(init).toMatchObject({ method: 'POST' })
    expect(JSON.parse(init.body)).toEqual({ name: 'VIP' })
  })

  it('flags a 409 as a duplicate name (no tag)', async () => {
    mockFetch(409, { error: 'Tag name already exists', code: 'duplicate_name' })
    expect(await createTagRequest('VIP')).toEqual({ ok: false, duplicate: true })
  })

  it('returns a plain failure (not duplicate) on other errors', async () => {
    mockFetch(500, { error: 'boom' })
    expect(await createTagRequest('VIP')).toEqual({ ok: false })
  })
})

describe('renameTagRequest', () => {
  it('PATCHes the tag id and returns the updated tag on 200', async () => {
    const fetchMock = mockFetch(200, TAG)
    const result = await renameTagRequest('t-1', 'VIP')
    expect(result).toEqual({ ok: true, tag: TAG })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/dashboard/tags/t-1')
    expect(init).toMatchObject({ method: 'PATCH' })
    expect(JSON.parse(init.body)).toEqual({ name: 'VIP' })
  })

  it('flags a 409 as a duplicate name', async () => {
    mockFetch(409, { code: 'duplicate_name' })
    expect(await renameTagRequest('t-1', 'VIP')).toEqual({ ok: false, duplicate: true })
  })
})

describe('deleteTagRequest', () => {
  it('DELETEs the tag id and reports ok', async () => {
    const fetchMock = mockFetch(200, { success: true })
    expect(await deleteTagRequest('t-1')).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/dashboard/tags/t-1')
    expect(init).toMatchObject({ method: 'DELETE' })
  })

  it('reports not ok when the tag is missing', async () => {
    mockFetch(404, { error: 'Tag not found' })
    expect(await deleteTagRequest('t-1')).toEqual({ ok: false })
  })
})
