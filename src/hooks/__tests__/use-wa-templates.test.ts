import { describe, it, expect, vi } from 'vitest'
import {
  createRequestStore,
  viewRequest,
  templateListTarget,
  singleTemplateTarget,
  parseTemplateList,
  parseTemplate,
  type RequestTarget,
} from '../use-wa-templates'

// No React renderer in this repo (see use-tag-recipient-count.test.ts), so the
// abort / stale-response / failure logic lives in a framework-free store that is
// exercised directly; the useSyncExternalStore wrappers are left to the browser pass.

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function tick(times = 5) {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

const A: RequestTarget = { key: 'r-1|a', url: '/a' }
const B: RequestTarget = { key: 'r-1|b', url: '/b' }

const row = (id: string) => ({
  id,
  restaurantId: 'r-1',
  metaTemplateId: null,
  name: `tpl_${id}`,
  language: 'zh_HK',
  category: 'MARKETING',
  status: 'approved',
  components: [{ type: 'BODY', text: 'Hi' }],
  parameterFormat: 'NAMED',
  rejectionReason: null,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
})

describe('createRequestStore', () => {
  it('ignores a stale response that resolves after a newer request', async () => {
    const slowA = deferred<string[]>()
    const fastB = deferred<string[]>()
    const fetcher = vi.fn((url: string) => (url === '/a' ? slowA.promise : fastB.promise))
    const store = createRequestStore(fetcher, [] as string[])

    store.load(A)
    store.load(B)
    fastB.resolve(['b'])
    await tick()
    slowA.resolve(['a'])
    await tick()

    expect(store.getState()).toEqual({ key: B.key, data: ['b'], isLoading: false, error: null })
  })

  it('aborts the in-flight request when a new one starts and on destroy (unmount)', () => {
    const signals: AbortSignal[] = []
    const store = createRequestStore((_url: string, signal: AbortSignal) => {
      signals.push(signal)
      return new Promise<string[]>(() => {})
    }, [])

    store.load(A)
    store.load(B)
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(false)

    store.destroy()
    expect(signals[1].aborted).toBe(true)
  })

  it('a response arriving after destroy is dropped', async () => {
    const pending = deferred<string[]>()
    const store = createRequestStore(() => pending.promise, [] as string[])
    store.load(A)
    store.destroy()
    pending.resolve(['late'])
    await tick()
    expect(store.getState().data).toEqual([])
  })

  it('on failure clears data to empty and sets error, even after an earlier success', async () => {
    const fetcher = vi
      .fn<(url: string, signal: AbortSignal) => Promise<string[]>>()
      .mockResolvedValueOnce(['a'])
      .mockRejectedValueOnce(new Error('Failed to fetch templates (500)'))
    const store = createRequestStore(fetcher, [] as string[])

    store.load(A)
    await tick()
    expect(store.getState().data).toEqual(['a'])

    store.load(A) // refetch, same key
    expect(store.getState()).toMatchObject({ data: ['a'], isLoading: true })
    await tick()
    expect(store.getState()).toEqual({
      key: A.key,
      data: [],
      isLoading: false,
      error: 'Failed to fetch templates (500)',
    })
  })

  it('a new key does not show the previous key data while loading', () => {
    const store = createRequestStore(() => new Promise<string[]>(() => {}), [] as string[])
    store.load(A)
    store.load(B)
    expect(store.getState()).toEqual({ key: B.key, data: [], isLoading: true, error: null })
  })

  it('load(null) fetches nothing and is not loading', () => {
    const fetcher = vi.fn()
    const store = createRequestStore(fetcher, [] as string[])
    store.load(null)
    expect(fetcher).not.toHaveBeenCalled()
    expect(store.getState()).toEqual({ key: null, data: [], isLoading: false, error: null })
  })

  it('notifies subscribers on every state change', async () => {
    const store = createRequestStore(async () => ['a'], [] as string[])
    const listener = vi.fn()
    store.subscribe(listener)
    store.load(A)
    await tick()
    expect(listener).toHaveBeenCalledTimes(2) // loading, settled
  })
})

describe('viewRequest (what the hook returns for the current target)', () => {
  const settled = { key: A.key, data: ['a'], isLoading: false, error: null }

  it('no target (restaurantId null or disabled) → empty, not loading, no error', () => {
    expect(viewRequest(settled, null, [])).toEqual({ data: [], isLoading: false, error: null })
  })

  it('target not yet handed to the store (first render) → loading, empty data', () => {
    expect(viewRequest(settled, B, [])).toEqual({ data: [], isLoading: true, error: null })
  })

  it('target settled → its data and error', () => {
    expect(viewRequest(settled, A, [])).toEqual({ data: ['a'], isLoading: false, error: null })
    const failed = { key: A.key, data: [], isLoading: false, error: 'boom' }
    expect(viewRequest(failed, A, [])).toEqual({ data: [], isLoading: false, error: 'boom' })
  })
})

describe('request targets', () => {
  it('templateListTarget: null without a restaurant or when disabled', () => {
    expect(templateListTarget(null, { status: 'approved' }, true)).toBeNull()
    expect(templateListTarget('r-1', { status: 'approved' }, false)).toBeNull()
  })

  it('templateListTarget: filters in the url, tenant in the key', () => {
    const target = templateListTarget('r-1', { status: 'approved', category: 'MARKETING' }, true)
    expect(target?.url).toBe('/api/dashboard/wa-templates?status=approved&category=MARKETING')
    expect(templateListTarget('r-2', { status: 'approved', category: 'MARKETING' }, true)?.key).not.toBe(target?.key)
    expect(templateListTarget('r-1', undefined, true)?.url).toBe('/api/dashboard/wa-templates')
  })

  it('singleTemplateTarget: the existing GET /wa-templates/[id] route, id encoded; null without id or restaurant', () => {
    expect(singleTemplateTarget('r-1', 'a/b')?.url).toBe('/api/dashboard/wa-templates/a%2Fb')
    expect(singleTemplateTarget('r-1', null)).toBeNull()
    expect(singleTemplateTarget(null, 'wa-1')).toBeNull()
  })
})

describe('parse point', () => {
  it('parseTemplateList keeps well-formed rows and drops malformed ones', () => {
    const list = parseTemplateList({ templates: [row('1'), { id: 2 }, null, row('3')], total: 4 })
    expect(list.map((t) => t.id)).toEqual(['1', '3'])
  })

  it('parseTemplateList returns [] for a body without a templates array', () => {
    expect(parseTemplateList({ error: 'x' })).toEqual([])
    expect(parseTemplateList(null)).toEqual([])
  })

  it('parseTemplate returns the entity, and throws on a malformed body', () => {
    expect(parseTemplate(row('9')).id).toBe('9')
    expect(() => parseTemplate({ error: 'Template not found' })).toThrow(/malformed/i)
  })
})
