// WAQ-011-DETAIL: fetches the review panel's detail (template, campaigns,
// names) when the panel opens. Loading is derived from which (review,
// attempt) the stored result belongs to, so no state is set synchronously
// inside the effect and a stale response for a previous review is ignored.

'use client'

import { useState, useEffect, useCallback } from 'react'
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

export function useAdminTemplateReviewDetail(reviewId: string | null) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<DetailResult & { reviewId: string; attempt: number } | null>(null)

  useEffect(() => {
    if (!reviewId) return
    let cancelled = false
    loadTemplateReviewDetail(reviewId).then((r) => {
      if (!cancelled) setResult({ ...r, reviewId, attempt })
    })
    return () => { cancelled = true }
  }, [reviewId, attempt])

  const refetch = useCallback(() => setAttempt((a) => a + 1), [])
  const current = result && result.reviewId === reviewId && result.attempt === attempt ? result : null
  return {
    detail: current?.detail ?? null,
    isLoading: Boolean(reviewId) && !current,
    error: current?.error ?? null,
    refetch,
  }
}

export type TemplateReviewDetailState = ReturnType<typeof useAdminTemplateReviewDetail>
