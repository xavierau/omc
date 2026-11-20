// WAQ-011-DETAIL: fetches the review panel's detail (template, campaigns)
// when the panel opens. Every open — including reopening the same review — is
// a new load: closing drops the cached result, and a response is applied only
// to the open that requested it, so the decision buttons never unlock on
// stale data.

'use client'

import { useState, useEffect, useSyncExternalStore } from 'react'
import type { TemplateReviewDetail } from '@/application/get-template-review-detail'

export type {
  TemplateReviewDetail,
  TemplateReviewDetailCampaign,
  TemplateReviewDetailTemplate,
} from '@/application/get-template-review-detail'

export function buildTemplateReviewDetailUrl(reviewId: string): string {
  return `/api/admin/template-reviews/${encodeURIComponent(reviewId)}`
}

interface DetailResult {
  detail: TemplateReviewDetail | null
  error: string | null
}

export async function loadTemplateReviewDetail(reviewId: string): Promise<DetailResult> {
  try {
    const res = await fetch(buildTemplateReviewDetailUrl(reviewId))
    if (!res.ok) throw new Error('Failed to fetch template review detail')
    return { detail: (await res.json()) as TemplateReviewDetail, error: null }
  } catch (err) {
    return { detail: null, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export interface TemplateReviewDetailStoreState extends DetailResult {
  /** The open review this state belongs to; null = panel closed. */
  reviewId: string | null
  isLoading: boolean
}

const CLOSED: TemplateReviewDetailStoreState = { reviewId: null, isLoading: false, detail: null, error: null }

// Framework-free (same rationale as use-tag-recipient-count): no React
// renderer in this repo, so the open/close/stale-response logic is tested on
// the store directly; the hook below is a thin useSyncExternalStore wrapper.
export function createTemplateReviewDetailStore(
  deps: { load?: (reviewId: string) => Promise<DetailResult> } = {}
) {
  const load = deps.load ?? loadTemplateReviewDetail
  let state = CLOSED
  let generation = 0
  const listeners = new Set<() => void>()

  function set(next: TemplateReviewDetailStoreState) {
    state = next
    listeners.forEach((listener) => listener())
  }

  function open(reviewId: string | null) {
    const gen = ++generation
    if (!reviewId) { set(CLOSED); return }
    set({ reviewId, isLoading: true, detail: null, error: null })
    load(reviewId).then((r) => {
      if (gen === generation) set({ reviewId, isLoading: false, ...r })
    })
  }

  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    open,
    refetch: () => { if (state.reviewId) open(state.reviewId) },
    destroy: () => { generation += 1 },
  }
}

/**
 * The store catches up with `reviewId` in an effect, i.e. one render late;
 * until it has, the panel reads as loading — never the previous open's result.
 */
export function viewForReview(state: TemplateReviewDetailStoreState, reviewId: string | null) {
  if (state.reviewId !== reviewId) return { isLoading: reviewId !== null, detail: null, error: null }
  return { isLoading: state.isLoading, detail: state.detail, error: state.error }
}

export function useAdminTemplateReviewDetail(reviewId: string | null) {
  const [store] = useState(() => createTemplateReviewDetailStore())
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)

  useEffect(() => { store.open(reviewId) }, [store, reviewId])
  useEffect(() => () => store.destroy(), [store])

  return { ...viewForReview(state, reviewId), refetch: store.refetch }
}

export type TemplateReviewDetailState = ReturnType<typeof useAdminTemplateReviewDetail>
