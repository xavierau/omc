'use client'

// Framework-free orchestration for the campaign member picker (GH #103 review
// round). Kept plain (no React) so the async/race logic below is directly
// unit-testable with fake timers — mirroring qr-scanner-helpers.ts's
// watchViewportChange — instead of relying on a DOM renderer this repo
// doesn't have (no @testing-library/react, no jsdom/happy-dom). The
// container component wires this to React via useSyncExternalStore.
//
// Guards implemented here:
//  - generation counter: a stale search or "Load more" response that
//    resolves after a newer search started is dropped instead of
//    overwriting members/total/page/totalPages.
//  - dedupeAppend: default last_visit_at-desc ordering can shift between
//    page fetches, so the same member can land on two accumulated pages.
//  - busy flag (plain variable, not React state): a same-frame double
//    "Load more" click can't fire two fetches — a `loading`/`loadingMore`
//    *state* check would still be stale between the two clicks because
//    React hasn't re-rendered yet.
//  - destroy(): clears the pending debounce timer and invalidates any
//    in-flight fetch so unmount can't trigger a late setState-equivalent.
import {
  fetchMemberPage,
  PICKER_PAGE_SIZE,
  type MemberPageParams,
  type MemberPageResult,
  type PickerMember,
} from '@/hooks/campaign-member-picker-client'

export interface PickerState {
  search: string
  members: PickerMember[]
  total: number
  page: number
  totalPages: number
  loading: boolean
  loadingMore: boolean
  error: boolean
}

const INITIAL_STATE: PickerState = {
  search: '',
  members: [],
  total: 0,
  page: 1,
  totalPages: 1,
  loading: true,
  loadingMore: false,
  error: false,
}

const SEARCH_DEBOUNCE_MS = 300

export interface MemberPickerStoreDeps {
  fetchPage?: (params: MemberPageParams) => Promise<MemberPageResult>
  debounceMs?: number
}

// Server ordering (last_visit_at desc) can shift a member across the page
// boundary between two accumulated fetches — filter ids already present.
export function dedupeAppend(prev: PickerMember[], next: PickerMember[]): PickerMember[] {
  const seen = new Set(prev.map((m) => m.id))
  return [...prev, ...next.filter((m) => !seen.has(m.id))]
}

export function createMemberPickerStore(deps: MemberPickerStoreDeps = {}) {
  const fetchPage = deps.fetchPage ?? fetchMemberPage
  const debounceMs = deps.debounceMs ?? SEARCH_DEBOUNCE_MS

  let state: PickerState = { ...INITIAL_STATE }
  let debouncedSearch = ''
  let generation = 0
  let busy = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const listeners = new Set<() => void>()

  function setState(patch: Partial<PickerState>) {
    state = { ...state, ...patch }
    listeners.forEach((listener) => listener())
  }

  function load(targetPage: number, term: string, append: boolean) {
    busy = true
    const gen = generation
    setState(append ? { loadingMore: true, error: false } : { loading: true, error: false })

    fetchPage({ search: term, page: targetPage, pageSize: PICKER_PAGE_SIZE })
      .then((result) => {
        if (gen !== generation) return
        setState({
          members: append ? dedupeAppend(state.members, result.members) : result.members,
          total: result.total,
          page: result.page,
          totalPages: result.totalPages,
        })
      })
      .catch(() => {
        if (gen !== generation) return
        setState({ error: true, ...(append ? {} : { members: [] }) })
      })
      .finally(() => {
        // Only the settle of the CURRENT generation's own fetch may clear
        // `busy`. Clearing it unconditionally here would let a stale fetch
        // (e.g. an abandoned "Load more") release the reentrancy guard
        // while a newer, still-current fetch is in flight — a same-frame
        // "Load more" click could then slip through and fire a second
        // request sharing that newer fetch's generation, defeating the
        // stale-response guard for both (round-3 review finding).
        if (gen !== generation) return
        busy = false
        setState(append ? { loadingMore: false } : { loading: false })
      })
  }

  return {
    getState: (): PickerState => state,

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    init(): void {
      load(1, '', false)
    },

    setSearch(value: string): void {
      setState({ search: value })
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        debouncedSearch = value
        generation += 1
        load(1, value, false)
      }, debounceMs)
    },

    loadMore(): void {
      if (busy) return
      if (state.page >= state.totalPages) return
      load(state.page + 1, debouncedSearch, true)
    },

    // Unions onto the existing selection (scoped to the currently loaded
    // members) so switching search terms never silently drops an earlier
    // pick — the same silent under-target class this component exists
    // to fix.
    selectAll(selectedIds: string[], onChange: (ids: string[]) => void): void {
      const loadedIds = state.members.map((m) => m.id)
      onChange(Array.from(new Set([...selectedIds, ...loadedIds])))
    },

    // Symmetric with selectAll: removes only the currently loaded members
    // from the selection, leaving picks from a different search untouched.
    deselectAll(selectedIds: string[], onChange: (ids: string[]) => void): void {
      const loadedIds = new Set(state.members.map((m) => m.id))
      onChange(selectedIds.filter((id) => !loadedIds.has(id)))
    },

    destroy(): void {
      if (timer) clearTimeout(timer)
      generation += 1
    },
  }
}

export type MemberPickerStore = ReturnType<typeof createMemberPickerStore>
