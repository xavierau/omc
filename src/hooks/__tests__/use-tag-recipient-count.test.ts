import { describe, it, expect, vi, afterEach } from 'vitest'
import { createTagRecipientCountStore } from '../use-tag-recipient-count'

// Framework-free store — same rationale as campaign-member-picker-store.ts:
// no React renderer exists in this repo (no @testing-library/react, no
// jsdom/happy-dom), so the debounce/abort orchestration is exercised
// directly here with fake timers, and the thin useSyncExternalStore wrapper
// in use-tag-recipient-count.ts is left to browser verification.

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// Flushes pending microtasks (the store's .then/.catch chain) without
// depending on real or fake timers.
async function tick(times = 5) {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createTagRecipientCountStore — empty tagIds', () => {
  it('skips the fetch entirely and reports count: null, not loading', () => {
    const fetchCount = vi.fn()
    const store = createTagRecipientCountStore({ fetchCount })

    store.setTagIds([])

    expect(fetchCount).not.toHaveBeenCalled()
    expect(store.getState()).toEqual({ count: null, isLoading: false, error: false })
  })

  it('resets to the empty state when tagIds is cleared after a selection', () => {
    vi.useFakeTimers()
    const fetchCount = vi.fn().mockReturnValue(new Promise(() => {}))
    const store = createTagRecipientCountStore({ fetchCount, debounceMs: 300 })

    store.setTagIds(['t-1'])
    vi.advanceTimersByTime(300)
    expect(store.getState().isLoading).toBe(true)

    store.setTagIds([])
    expect(store.getState()).toEqual({ count: null, isLoading: false, error: false })
  })
})

describe('createTagRecipientCountStore — debounce', () => {
  it('does not fetch until debounceMs elapses', () => {
    vi.useFakeTimers()
    const fetchCount = vi.fn().mockReturnValue(new Promise(() => {}))
    const store = createTagRecipientCountStore({ fetchCount, debounceMs: 300 })

    store.setTagIds(['t-1'])
    expect(fetchCount).not.toHaveBeenCalled()
    vi.advanceTimersByTime(299)
    expect(fetchCount).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fetchCount).toHaveBeenCalledTimes(1)
    expect(fetchCount).toHaveBeenCalledWith(['t-1'], expect.any(AbortSignal))
  })

  it('sets isLoading true as soon as tagIds change, before the debounce fires', () => {
    vi.useFakeTimers()
    const fetchCount = vi.fn().mockReturnValue(new Promise(() => {}))
    const store = createTagRecipientCountStore({ fetchCount, debounceMs: 300 })

    store.setTagIds(['t-1'])
    expect(store.getState().isLoading).toBe(true)
  })

  it('collapses rapid selection changes into a single request for the final ids (T-F3.4)', () => {
    vi.useFakeTimers()
    const fetchCount = vi.fn().mockReturnValue(new Promise(() => {}))
    const store = createTagRecipientCountStore({ fetchCount, debounceMs: 300 })

    store.setTagIds(['t-1'])
    vi.advanceTimersByTime(100)
    store.setTagIds(['t-1', 't-2'])
    vi.advanceTimersByTime(100)
    store.setTagIds(['t-1', 't-2', 't-3'])
    vi.advanceTimersByTime(300)

    expect(fetchCount).toHaveBeenCalledTimes(1)
    expect(fetchCount).toHaveBeenCalledWith(['t-1', 't-2', 't-3'], expect.any(AbortSignal))
  })

  it('issues one request carrying every selected id (T-F3.3)', () => {
    vi.useFakeTimers()
    const fetchCount = vi.fn().mockReturnValue(new Promise(() => {}))
    const store = createTagRecipientCountStore({ fetchCount, debounceMs: 300 })

    store.setTagIds(['t-1', 't-2'])
    vi.advanceTimersByTime(300)

    expect(fetchCount).toHaveBeenCalledTimes(1)
    expect(fetchCount).toHaveBeenCalledWith(['t-1', 't-2'], expect.any(AbortSignal))
  })
})

describe('createTagRecipientCountStore — abort on change (T-F3.4)', () => {
  it('aborts an in-flight request when tagIds change again before it resolves', async () => {
    const first = deferred<number>()
    const fetchCount = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(new Promise(() => {}))
    const store = createTagRecipientCountStore({ fetchCount, debounceMs: 1 })

    store.setTagIds(['t-1'])
    await wait(5)
    expect(fetchCount).toHaveBeenCalledTimes(1)
    const firstSignal = fetchCount.mock.calls[0][1] as AbortSignal
    expect(firstSignal.aborted).toBe(false)

    store.setTagIds(['t-1', 't-2'])
    expect(firstSignal.aborted).toBe(true)

    // the stale first request resolving late must not clobber the newer state
    first.resolve(42)
    await tick()
    expect(store.getState().count).not.toBe(42)
  })

  it('ignores a stale response that resolves after a newer selection was made', async () => {
    const first = deferred<number>()
    const second = deferred<number>()
    const fetchCount = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const store = createTagRecipientCountStore({ fetchCount, debounceMs: 1 })

    store.setTagIds(['t-1'])
    await wait(5)
    store.setTagIds(['t-2'])
    await wait(5)
    expect(fetchCount).toHaveBeenCalledTimes(2)

    second.resolve(7)
    await tick()
    expect(store.getState().count).toBe(7)

    first.resolve(999)
    await tick()
    expect(store.getState().count).toBe(7)
  })
})

describe('createTagRecipientCountStore — success', () => {
  it('reports the resolved count and clears loading', async () => {
    const fetchCount = vi.fn().mockResolvedValue(5)
    const store = createTagRecipientCountStore({ fetchCount, debounceMs: 1 })

    store.setTagIds(['t-1'])
    await wait(5)
    await tick()

    expect(store.getState()).toEqual({ count: 5, isLoading: false, error: false })
  })

  it('reports a zero count as a normal, non-error result (T-F3.5)', async () => {
    const fetchCount = vi.fn().mockResolvedValue(0)
    const store = createTagRecipientCountStore({ fetchCount, debounceMs: 1 })

    store.setTagIds(['t-1'])
    await wait(5)
    await tick()

    expect(store.getState()).toEqual({ count: 0, isLoading: false, error: false })
  })
})

describe('createTagRecipientCountStore — error (T-F3.6)', () => {
  it('sets error and clears loading on a failed request', async () => {
    const fetchCount = vi.fn().mockRejectedValue(new Error('network'))
    const store = createTagRecipientCountStore({ fetchCount, debounceMs: 1 })

    store.setTagIds(['t-1'])
    await wait(5)
    await tick()

    expect(store.getState()).toEqual({ count: null, isLoading: false, error: true })
  })

  it('clears a stale error once a retried selection succeeds', async () => {
    const fetchCount = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(3)
    const store = createTagRecipientCountStore({ fetchCount, debounceMs: 1 })

    store.setTagIds(['t-1'])
    await wait(5)
    await tick()
    expect(store.getState().error).toBe(true)

    store.setTagIds(['t-1', 't-2'])
    await wait(5)
    await tick()

    expect(store.getState()).toEqual({ count: 3, isLoading: false, error: false })
  })
})

describe('createTagRecipientCountStore — destroy (unmount cleanup)', () => {
  it('destroy() clears a pending debounce timer', () => {
    vi.useFakeTimers()
    const fetchCount = vi.fn().mockReturnValue(new Promise(() => {}))
    const store = createTagRecipientCountStore({ fetchCount, debounceMs: 300 })

    store.setTagIds(['t-1'])
    store.destroy()
    vi.advanceTimersByTime(1000)

    expect(fetchCount).not.toHaveBeenCalled()
  })

  it('destroy() aborts an in-flight request so its late resolution is ignored', async () => {
    const inFlight = deferred<number>()
    const fetchCount = vi.fn().mockReturnValueOnce(inFlight.promise)
    const store = createTagRecipientCountStore({ fetchCount, debounceMs: 1 })

    store.setTagIds(['t-1'])
    await wait(5)
    const signal = fetchCount.mock.calls[0][1] as AbortSignal

    store.destroy()
    expect(signal.aborted).toBe(true)

    inFlight.resolve(9)
    await tick()
    expect(store.getState().count).toBe(null)
  })
})

describe('createTagRecipientCountStore — subscribe', () => {
  it('notifies subscribers on every state change', async () => {
    const fetchCount = vi.fn().mockResolvedValue(1)
    const store = createTagRecipientCountStore({ fetchCount, debounceMs: 1 })
    const listener = vi.fn()
    store.subscribe(listener)

    store.setTagIds(['t-1'])
    await wait(5)
    await tick()

    expect(listener).toHaveBeenCalled()
  })

  it('stops notifying after unsubscribe', async () => {
    const fetchCount = vi.fn().mockResolvedValue(1)
    const store = createTagRecipientCountStore({ fetchCount, debounceMs: 1 })
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    unsubscribe()

    store.setTagIds(['t-1'])
    await wait(5)
    await tick()

    expect(listener).not.toHaveBeenCalled()
  })
})
