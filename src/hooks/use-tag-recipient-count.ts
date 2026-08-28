'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'

const DEBOUNCE_MS = 300
const ENDPOINT = '/api/dashboard/tags/recipient-count'

export interface TagRecipientCountState {
  count: number | null
  isLoading: boolean
  error: boolean
}

const INITIAL_STATE: TagRecipientCountState = { count: null, isLoading: false, error: false }

async function fetchRecipientCount(tagIds: string[], signal: AbortSignal): Promise<number> {
  const query = tagIds.map(encodeURIComponent).join(',')
  const res = await fetch(`${ENDPOINT}?tagIds=${query}`, { signal })
  if (!res.ok) throw new Error(`recipient-count request failed (${res.status})`)
  const json = await res.json()
  return typeof json.count === 'number' ? json.count : 0
}

export interface TagRecipientCountStoreDeps {
  fetchCount?: (tagIds: string[], signal: AbortSignal) => Promise<number>
  debounceMs?: number
}

// Framework-free orchestration, mirroring campaign-member-picker-store.ts —
// kept plain (no React) so the debounce/abort/stale-response race logic is
// directly unit-testable with fake timers instead of relying on a DOM
// renderer this repo doesn't have (no @testing-library/react, no
// jsdom/happy-dom). The hook below wires this to React via
// useSyncExternalStore.
export function createTagRecipientCountStore(deps: TagRecipientCountStoreDeps = {}) {
  const fetchCount = deps.fetchCount ?? fetchRecipientCount
  const debounceMs = deps.debounceMs ?? DEBOUNCE_MS

  let state: TagRecipientCountState = { ...INITIAL_STATE }
  let timer: ReturnType<typeof setTimeout> | null = null
  let controller: AbortController | null = null
  let generation = 0
  const listeners = new Set<() => void>()

  function setState(patch: Partial<TagRecipientCountState>) {
    state = { ...state, ...patch }
    listeners.forEach((listener) => listener())
  }

  function clearPending() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (controller) {
      controller.abort()
      controller = null
    }
  }

  function setTagIds(tagIds: string[]) {
    clearPending()
    generation += 1
    const gen = generation

    if (tagIds.length === 0) {
      setState({ count: null, isLoading: false, error: false })
      return
    }

    setState({ isLoading: true, error: false })
    timer = setTimeout(() => {
      const ac = new AbortController()
      controller = ac
      fetchCount(tagIds, ac.signal)
        .then((count) => {
          if (gen !== generation) return
          setState({ count, isLoading: false, error: false })
        })
        .catch(() => {
          if (gen !== generation) return
          setState({ count: null, isLoading: false, error: true })
        })
    }, debounceMs)
  }

  function destroy() {
    clearPending()
    generation += 1
  }

  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setTagIds,
    destroy,
  }
}

/**
 * Live recipient count for campaign tag-targeting (#138b). Debounces 300ms,
 * aborts the in-flight request when `tagIds` changes again or the component
 * unmounts, and skips the fetch entirely for an empty selection.
 */
export function useTagRecipientCount(tagIds: string[]): TagRecipientCountState {
  const [store] = useState(() => createTagRecipientCountStore())
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const key = tagIds.join(',')

  useEffect(() => {
    store.setTagIds(key === '' ? [] : key.split(','))
  }, [store, key])

  useEffect(() => () => store.destroy(), [store])

  return state
}
