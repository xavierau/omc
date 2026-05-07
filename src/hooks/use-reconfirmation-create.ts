'use client'

import { useState, useCallback } from 'react'
import type { PreflightViolation } from './use-reconfirmation-preflight'

export interface CreateReconfirmationCampaignInput {
  mode: 'reconfirmation'
  name: string
  templateId: string
}

export interface CreateReconfirmationCampaignResult {
  campaignId: string
}

export function buildReconfirmationCampaignUrl(): string {
  return '/api/dashboard/campaigns'
}

/**
 * Hook-layer guard: forces mode to 'reconfirmation' regardless of caller input,
 * so a misuse can never silently fall back to a marketing-mode campaign.
 */
export function buildReconfirmationCreateBody(
  input: CreateReconfirmationCampaignInput
): CreateReconfirmationCampaignInput {
  return { ...input, mode: 'reconfirmation' }
}

export interface UseReconfirmationCreateResult {
  submit: (
    input: CreateReconfirmationCampaignInput
  ) => Promise<CreateReconfirmationCampaignResult | null>
  isSubmitting: boolean
  error: string | null
  result: CreateReconfirmationCampaignResult | null
  violations: PreflightViolation[]
}

interface ErrorBody {
  error?: string
  reason?: string
  violations?: PreflightViolation[]
}

async function readErrorBody(res: Response): Promise<ErrorBody> {
  return ((await res.json().catch(() => null)) as ErrorBody | null) ?? {}
}

export function useReconfirmationCreate(): UseReconfirmationCreateResult {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CreateReconfirmationCampaignResult | null>(null)
  const [violations, setViolations] = useState<PreflightViolation[]>([])

  const submit = useCallback(
    async (
      input: CreateReconfirmationCampaignInput
    ): Promise<CreateReconfirmationCampaignResult | null> => {
      setIsSubmitting(true)
      setError(null)
      setViolations([])
      try {
        const res = await fetch(buildReconfirmationCampaignUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildReconfirmationCreateBody(input)),
        })
        if (!res.ok) {
          const body = await readErrorBody(res)
          setViolations(body.violations ?? [])
          setError(String(body.reason ?? body.error ?? `Request failed (${res.status})`))
          return null
        }
        const json = (await res.json()) as CreateReconfirmationCampaignResult
        setResult(json)
        return json
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Request failed')
        return null
      } finally {
        setIsSubmitting(false)
      }
    },
    []
  )

  return { submit, isSubmitting, error, result, violations }
}
