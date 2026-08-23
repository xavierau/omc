import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  createMemberPickerStore,
  dedupeAppend,
} from '../campaign-member-picker-store'
import { PICKER_PAGE_SIZE, type MemberPageResult, type PickerMember } from '@/hooks/campaign-member-picker-client'

// Framework-free store — no React renderer exists in this repo
// (no @testing-library/react, no jsdom/happy-dom, no react-test-renderer),
// so all of the race/debounce/reentrancy logic that used to live directly in
// campaign-member-picker.tsx's useEffect is exercised here directly, the same
// way qr-scanner-helpers.ts's watchViewportChange is tested with fake timers
// instead of through the DOM.

function m(id: string, overrides: Partial<PickerMember> = {}): PickerMember {
  return { id, name: `Member ${id}`, phone: `+8529${id.padStart(7, '0')}`, ...overrides }
}

function page(members: PickerMember[], overrides: Partial<MemberPageResult> = {}): MemberPageResult {
  return { members, total: members.length, page: 1, totalPages: 1, ...overrides }
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// Flushes pending microtasks (the store's .then/.catch/.finally chain)
// without depending on real or fake timers.
async function tick(times = 5) {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('dedupeAppend', () => {
  it('drops ids already present in prev', () => {
    const result = dedupeAppend([m('1'), m('2')], [m('2'), m('3')])
    expect(result.map((x) => x.id)).toEqual(['1', '2', '3'])
  })

  it('preserves prev order and appends only the new ones in next order', () => {
    const result = dedupeAppend([m('a')], [m('b'), m('a'), m('c')])
    expect(result.map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('createMemberPickerStore — debounce', () => {
  it('does not fetch until debounceMs elapses', () => {
    vi.useFakeTimers()
    const fetchPage = vi.fn().mockReturnValue(new Promise(() => {}))
    const store = createMemberPickerStore({ fetchPage, debounceMs: 300 })

    store.setSearch('wong')
    expect(fetchPage).not.toHaveBeenCalled()
    vi.advanceTimersByTime(299)
    expect(fetchPage).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(fetchPage).toHaveBeenCalledWith({ search: 'wong', page: 1, pageSize: PICKER_PAGE_SIZE })
  })

  it('collapses rapid typing into a single fetch for the final term', () => {
    vi.useFakeTimers()
    const fetchPage = vi.fn().mockReturnValue(new Promise(() => {}))
    const store = createMemberPickerStore({ fetchPage, debounceMs: 300 })

    store.setSearch('w')
    vi.advanceTimersByTime(100)
    store.setSearch('wo')
    vi.advanceTimersByTime(100)
    store.setSearch('won')
    vi.advanceTimersByTime(300)

    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(fetchPage).toHaveBeenCalledWith(expect.objectContaining({ search: 'won' }))
  })
})

describe('createMemberPickerStore — accumulation', () => {
  it('replaces the list on init and appends on loadMore', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page([m('1'), m('2')], { total: 4, page: 1, totalPages: 2 }))
      .mockResolvedValueOnce(page([m('3'), m('4')], { total: 4, page: 2, totalPages: 2 }))
    const store = createMemberPickerStore({ fetchPage })

    store.init()
    await tick()
    expect(store.getState().members.map((x) => x.id)).toEqual(['1', '2'])

    store.loadMore()
    await tick()
    expect(store.getState().members.map((x) => x.id)).toEqual(['1', '2', '3', '4'])
    expect(store.getState().page).toBe(2)
  })

  it('dedupes members that reappear on a later accumulated page', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page([m('1'), m('2')], { total: 3, page: 1, totalPages: 2 }))
      .mockResolvedValueOnce(page([m('2'), m('3')], { total: 3, page: 2, totalPages: 2 }))
    const store = createMemberPickerStore({ fetchPage })

    store.init()
    await tick()
    store.loadMore()
    await tick()

    const ids = store.getState().members.map((x) => x.id)
    expect(ids).toEqual(['1', '2', '3'])
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('createMemberPickerStore — stale response guard', () => {
  it('ignores a stale search response resolving after a newer search started', async () => {
    const first = deferred<MemberPageResult>()
    const second = deferred<MemberPageResult>()
    const fetchPage = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const store = createMemberPickerStore({ fetchPage, debounceMs: 1 })

    store.setSearch('wong')
    await wait(5)
    store.setSearch('chan')
    await wait(5)
    expect(fetchPage).toHaveBeenCalledTimes(2)

    // 'chan' (the newer search) resolves first
    second.resolve(page([m('c1')], { total: 1 }))
    await tick()
    expect(store.getState().members.map((x) => x.id)).toEqual(['c1'])

    // the stale 'wong' response arrives late — must not clobber 'chan' results
    first.resolve(page([m('w1'), m('w2')], { total: 2 }))
    await tick()
    expect(store.getState().members.map((x) => x.id)).toEqual(['c1'])
    expect(store.getState().total).toBe(1)
  })

  it('ignores a stale Load-more response once a newer search has started', async () => {
    const staleLoadMore = deferred<MemberPageResult>()
    const newSearchPage1 = deferred<MemberPageResult>()
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page([m('1')], { total: 5, page: 1, totalPages: 3 }))
      .mockReturnValueOnce(staleLoadMore.promise)
      .mockReturnValueOnce(newSearchPage1.promise)
    const store = createMemberPickerStore({ fetchPage, debounceMs: 1 })

    store.init()
    await tick()
    expect(store.getState().members.map((x) => x.id)).toEqual(['1'])

    store.loadMore() // in flight for the '' search, page 2
    store.setSearch('chan')
    await wait(5) // fires the new search's page-1 fetch, invalidating the load-more

    staleLoadMore.resolve(page([m('2'), m('3')], { total: 5, page: 2, totalPages: 3 }))
    await tick()
    // must not have appended the stale rows
    expect(store.getState().members.map((x) => x.id)).toEqual(['1'])

    newSearchPage1.resolve(page([m('c1')], { total: 1 }))
    await tick()
    expect(store.getState().members.map((x) => x.id)).toEqual(['c1'])
    expect(store.getState().total).toBe(1)
    expect(store.getState().totalPages).toBe(1)
  })
})

describe('createMemberPickerStore — select all / deselect all', () => {
  it('unions Select-all onto the existing selection instead of replacing it', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce(page([m('c1'), m('c2')], { total: 2 }))
    const store = createMemberPickerStore({ fetchPage })
    store.init()
    await tick()

    const onChange = vi.fn()
    store.selectAll(['w1', 'w2'], onChange)

    expect(onChange).toHaveBeenCalledTimes(1)
    const result = onChange.mock.calls[0][0] as string[]
    expect(new Set(result)).toEqual(new Set(['w1', 'w2', 'c1', 'c2']))
  })

  it('does not duplicate ids already selected among the loaded members', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce(page([m('c1')], { total: 1 }))
    const store = createMemberPickerStore({ fetchPage })
    store.init()
    await tick()

    const onChange = vi.fn()
    store.selectAll(['c1', 'w1'], onChange)

    const result = onChange.mock.calls[0][0] as string[]
    expect(new Set(result)).toEqual(new Set(['c1', 'w1']))
    expect(result.length).toBe(2)
  })

  it('scopes Deselect-all to the currently loaded members, leaving other-search picks intact', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce(page([m('c1'), m('c2')], { total: 2 }))
    const store = createMemberPickerStore({ fetchPage })
    store.init()
    await tick()

    const onChange = vi.fn()
    store.deselectAll(['w1', 'c1', 'c2'], onChange)

    expect(onChange).toHaveBeenCalledWith(['w1'])
  })
})

describe('createMemberPickerStore — Load-more reentrancy guard', () => {
  it('ignores a same-frame double Load-more click', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page([m('1')], { total: 3, page: 1, totalPages: 2 }))
      .mockReturnValueOnce(new Promise(() => {}))
    const store = createMemberPickerStore({ fetchPage })
    store.init()
    await tick()

    store.loadMore()
    store.loadMore() // synchronous second click, before any await/render
    expect(fetchPage).toHaveBeenCalledTimes(2) // init + one loadMore, not two
  })

  it('ignores Load-more clicked while the initial page is still loading', () => {
    const fetchPage = vi.fn().mockReturnValue(new Promise(() => {}))
    const store = createMemberPickerStore({ fetchPage })
    store.init()
    store.loadMore()
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('does nothing when there is no further page to load', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce(page([m('1')], { total: 1, page: 1, totalPages: 1 }))
    const store = createMemberPickerStore({ fetchPage })
    store.init()
    await tick()
    store.loadMore()
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })
})

describe('createMemberPickerStore — unmount cleanup', () => {
  it('destroy() clears the pending debounce timer', () => {
    vi.useFakeTimers()
    const fetchPage = vi.fn().mockReturnValue(new Promise(() => {}))
    const store = createMemberPickerStore({ fetchPage, debounceMs: 300 })

    store.setSearch('wong')
    store.destroy()
    vi.advanceTimersByTime(1000)
    expect(fetchPage).not.toHaveBeenCalled()
  })

  it('destroy() invalidates an in-flight fetch so its late resolution is ignored', async () => {
    const inFlight = deferred<MemberPageResult>()
    const fetchPage = vi.fn().mockReturnValueOnce(inFlight.promise)
    const store = createMemberPickerStore({ fetchPage })

    store.init()
    store.destroy()
    inFlight.resolve(page([m('1')], { total: 1 }))
    await tick()

    expect(store.getState().members).toEqual([])
  })
})

describe('createMemberPickerStore — error state', () => {
  it('sets error on a failed initial load and does not populate members', async () => {
    const fetchPage = vi.fn().mockRejectedValueOnce(new Error('network'))
    const store = createMemberPickerStore({ fetchPage })

    store.init()
    await tick()

    expect(store.getState().error).toBe(true)
    expect(store.getState().members).toEqual([])
    expect(store.getState().loading).toBe(false)
  })

  it('sets error on a failed Load-more but keeps the already-loaded members (not fully silent)', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page([m('1')], { total: 3, page: 1, totalPages: 2 }))
      .mockRejectedValueOnce(new Error('network'))
    const store = createMemberPickerStore({ fetchPage })

    store.init()
    await tick()
    store.loadMore()
    await tick()

    expect(store.getState().error).toBe(true)
    expect(store.getState().members.map((x) => x.id)).toEqual(['1'])
    expect(store.getState().loadingMore).toBe(false)
  })

  it('clears a stale error once a retried load succeeds', async () => {
    const fetchPage = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(page([m('1')], { total: 1 }))
    const store = createMemberPickerStore({ fetchPage, debounceMs: 1 })

    store.init()
    await tick()
    expect(store.getState().error).toBe(true)

    store.setSearch('wong')
    await wait(5)
    await tick()

    expect(store.getState().error).toBe(false)
    expect(store.getState().members.map((x) => x.id)).toEqual(['1'])
  })
})

describe('createMemberPickerStore — subscribe', () => {
  it('notifies subscribers on every state change', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce(page([m('1')], { total: 1 }))
    const store = createMemberPickerStore({ fetchPage })
    const listener = vi.fn()
    store.subscribe(listener)

    store.init()
    await tick()

    expect(listener).toHaveBeenCalled()
  })

  it('stops notifying after unsubscribe', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce(page([m('1')], { total: 1 }))
    const store = createMemberPickerStore({ fetchPage })
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    unsubscribe()

    store.init()
    await tick()

    expect(listener).not.toHaveBeenCalled()
  })
})
