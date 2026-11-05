/**
 * Pure client-side validators for the consent-proof file uploader.
 * Mirrors server-side validation; server is the source of truth.
 * Q-A6: bucket allows jpg/png/webp/pdf, ≤10MB.
 */

const ALLOWED_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const

export const PROOF_MAX_SIZE = 10 * 1024 * 1024 // 10 MB

export type ProofFileError = { kind: 'tooLarge' } | { kind: 'wrongType' }

export interface ProofFileMeta {
  type: string
  size: number
}

export function validateProofFile(file: ProofFileMeta): ProofFileError | null {
  if (!ALLOWED_MIME.includes(file.type as (typeof ALLOWED_MIME)[number])) {
    return { kind: 'wrongType' }
  }
  if (file.size > PROOF_MAX_SIZE) return { kind: 'tooLarge' }
  return null
}
