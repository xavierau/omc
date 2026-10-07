// WAQ-011 admin queue: lists template reviews for the platform-admin decision
// page. Mirrors the fetch/loading/error shape of the other admin hooks
// (use-admin-audit-logs, use-quality-overview).

'use client'

import { useState, useEffect, useCallback } from 'react'

export type TemplateReviewStatus = 'pending' | 'approved' | 'rejected' | 'changes_requested'

export interface TemplateReviewItem {
  id: string
  restaurantId: string
  templateId: string | null
  templateName: string
  targetAudienceSize: number | null
  targetAudienceQuery: Record<string, unknown> | null
  contentPreview: string | null
  status: TemplateReviewStatus
  submittedBy: string
  submittedAt: string
  reviewedBy: string | null
  reviewedAt: string | null
  reviewNotes: string | null
}

interface TemplateReviewsResponse {
  status: TemplateReviewStatus
  reviews: TemplateReviewItem[]
}

export function buildTemplateReviewsUrl(status: TemplateReviewStatus): string {
  return `/api/admin/template-reviews?status=${status}`
}

export function useAdminTemplateReviews(status: TemplateReviewStatus) {
  const [reviews, setReviews] = useState<TemplateReviewItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchReviews = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const res = await fetch(buildTemplateReviewsUrl(status))
      if (!res.ok) throw new Error('Failed to fetch template reviews')
      const json = (await res.json()) as TemplateReviewsResponse
      setReviews(json.reviews ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [status])

  useEffect(() => {
    fetchReviews()
  }, [fetchReviews])

  return { reviews, isLoading, error, refetch: fetchReviews }
}
