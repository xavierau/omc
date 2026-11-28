import { describe, it, expect, vi } from 'vitest'
import {
  createTemplateReviewDetailStore,
  viewForReview,
  type TemplateReviewDetail,
} from '../use-admin-template-review-detail'

// Framework-free store — same rationale as use-tag-recipient-count: no React
// renderer in this repo, so the open/close/reopen/stale-response logic is
// exercised here and the thin useSyncExternalStore wrapper is browser-verified.

type Result = { detail: TemplateReviewDetail | null; error: string | null }

function deferred() {
  let resolve!: (v: Result) => void
  const promise = new Promise<Result>((res) => { resolve = res })
  return { promise, resolve }
}

async function tick(times = 5) {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

const detailA1 = { review: { id: 'A' }, template: null, campaigns: null, campaignsError: false, tag: 'first' } as unknown as TemplateReviewDetail
const detailA2 = { review: { id: 'A' }, template: null, campaigns: null, campaignsError: false, tag: 'second' } as unknown as TemplateReviewDetail

function storeWith(...calls: ReturnType<typeof deferred>[]) {
  const load = vi.fn()
  calls.forEach((c) => load.mockReturnValueOnce(c.promise))
  return { store: createTemplateReviewDetailStore({ load }), load }
}

describe('createTemplateReviewDetailStore', () => {
  it('is loading from the moment a review opens until its fetch resolves', async () => {
    const first = deferred()
    const { store, load } = storeWith(first)

    store.open('A')
    expect(load).toHaveBeenCalledWith('A')
    expect(store.getState()).toMatchObject({ reviewId: 'A', isLoading: true, detail: null, error: null })

    first.resolve({ detail: detailA1, error: null })
    await tick()
    expect(store.getState()).toMatchObject({ reviewId: 'A', isLoading: false, detail: detailA1 })
  })

  it('closing clears the cached result', async () => {
    const first = deferred()
    const { store } = storeWith(first)
    store.open('A')
    first.resolve({ detail: detailA1, error: null })
    await tick()

    store.open(null)
    expect(store.getState()).toEqual({ reviewId: null, isLoading: false, detail: null, error: null })
  })

  it('reopening the same review shows no stale result and stays loading until THAT fetch resolves', async () => {
    const first = deferred()
    const second = deferred()
    const { store, load } = storeWith(first, second)
    store.open('A')
    first.resolve({ detail: detailA1, error: null })
    await tick()

    store.open(null)
    store.open('A')
    expect(load).toHaveBeenCalledTimes(2)
    expect(store.getState()).toMatchObject({ reviewId: 'A', isLoading: true, detail: null })

    second.resolve({ detail: detailA2, error: null })
    await tick()
    expect(store.getState()).toMatchObject({ isLoading: false, detail: detailA2 })
  })

  it('ignores a late response from an earlier open of the same review', async () => {
    const first = deferred()
    const second = deferred()
    const { store } = storeWith(first, second)
    store.open('A')
    store.open(null)
    store.open('A')

    first.resolve({ detail: detailA1, error: null })
    await tick()
    expect(store.getState()).toMatchObject({ isLoading: true, detail: null })

    second.resolve({ detail: detailA2, error: null })
    await tick()
    expect(store.getState().detail).toBe(detailA2)
  })

  it('refetch drops the current result and loads again', async () => {
    const first = deferred()
    const second = deferred()
    const { store } = storeWith(first, second)
    store.open('A')
    first.resolve({ detail: null, error: 'boom' })
    await tick()
    expect(store.getState()).toMatchObject({ isLoading: false, error: 'boom' })

    store.refetch()
    expect(store.getState()).toMatchObject({ isLoading: true, error: null, detail: null })
    second.resolve({ detail: detailA2, error: null })
    await tick()
    expect(store.getState()).toMatchObject({ isLoading: false, error: null, detail: detailA2 })
  })

  it('refetch does nothing while closed', () => {
    const { store, load } = storeWith()
    store.refetch()
    expect(load).not.toHaveBeenCalled()
  })

  it('notifies subscribers on every transition', async () => {
    const first = deferred()
    const { store } = storeWith(first)
    const listener = vi.fn()
    store.subscribe(listener)
    store.open('A')
    first.resolve({ detail: detailA1, error: null })
    await tick()
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('viewForReview', () => {
  const loadedA = { reviewId: 'A', isLoading: false, detail: detailA1, error: null }

  it('passes the state through when it belongs to the requested review', () => {
    expect(viewForReview(loadedA, 'A')).toEqual({ isLoading: false, detail: detailA1, error: null })
  })

  it('reports loading (never the stored result) before the store has caught up with a (re)open', () => {
    expect(viewForReview({ reviewId: null, isLoading: false, detail: null, error: null }, 'A'))
      .toEqual({ isLoading: true, detail: null, error: null })
    expect(viewForReview({ ...loadedA, reviewId: 'B' }, 'A'))
      .toEqual({ isLoading: true, detail: null, error: null })
  })

  it('reports nothing for a closed panel', () => {
    expect(viewForReview(loadedA, null)).toEqual({ isLoading: false, detail: null, error: null })
  })
})
