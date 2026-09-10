'use client'

import { useState, useCallback } from 'react'
import type {
  ImportBatchSummary,
  ImportContactsBatchInput,
  ImportContactsBatchResult,
  PreviewContactsBatchResult,
  ProofUploadResult,
} from './use-import-batch-types'

export type * from './use-import-batch-types'

type SubRoute = 'preview' | 'proof-upload'

export function buildImportUrl(sub?: SubRoute): string {
  const base = '/api/dashboard/imports'
  return sub ? `${base}/${sub}` : base
}

export function buildPreviewBody(
  input: ImportContactsBatchInput
): ImportContactsBatchInput {
  return input
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => null)
  return String(body?.reason ?? body?.error ?? `Request failed (${res.status})`)
}

export interface UseImportBatchResult {
  isLoading: boolean
  error: string | null
  previewBatch: (
    input: ImportContactsBatchInput
  ) => Promise<PreviewContactsBatchResult | null>
  commitBatch: (
    input: ImportContactsBatchInput
  ) => Promise<ImportContactsBatchResult | null>
  listBatches: () => Promise<ImportBatchSummary[]>
  uploadProof: (file: File) => Promise<ProofUploadResult | null>
}

export function useImportBatch(): UseImportBatchResult {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const callJson = useCallback(
    async <T,>(url: string, body: unknown): Promise<T | null> => {
      setIsLoading(true)
      setError(null)
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          setError(await readError(res))
          return null
        }
        return (await res.json()) as T
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Request failed')
        return null
      } finally {
        setIsLoading(false)
      }
    },
    []
  )

  const previewBatch = useCallback(
    (input: ImportContactsBatchInput) =>
      callJson<PreviewContactsBatchResult>(
        buildImportUrl('preview'),
        buildPreviewBody(input)
      ),
    [callJson]
  )

  const commitBatch = useCallback(
    (input: ImportContactsBatchInput) =>
      callJson<ImportContactsBatchResult>(buildImportUrl(), input),
    [callJson]
  )

  const listBatches = useCallback(async (): Promise<ImportBatchSummary[]> => {
    setError(null)
    try {
      const res = await fetch(buildImportUrl())
      if (!res.ok) {
        setError(await readError(res))
        return []
      }
      const data = (await res.json()) as { batches: ImportBatchSummary[] }
      return data.batches ?? []
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
      return []
    }
  }, [])

  const uploadProof = useCallback(
    async (file: File): Promise<ProofUploadResult | null> => {
      setIsLoading(true)
      setError(null)
      try {
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch(buildImportUrl('proof-upload'), {
          method: 'POST',
          body: fd,
        })
        if (!res.ok) {
          setError(await readError(res))
          return null
        }
        return (await res.json()) as ProofUploadResult
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Request failed')
        return null
      } finally {
        setIsLoading(false)
      }
    },
    []
  )

  return { isLoading, error, previewBatch, commitBatch, listBatches, uploadProof }
}
