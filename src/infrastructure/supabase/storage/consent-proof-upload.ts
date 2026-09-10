import { randomUUID } from 'node:crypto'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { ProofUploadValidationError } from './__errors__/proof-upload-errors'

const BUCKET = 'consent-proof'
const MAX_BYTES = 10 * 1024 * 1024
const SIGNED_URL_TTL_SECONDS = 300

export const ALLOWED_PROOF_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const

export type ProofMimeType = (typeof ALLOWED_PROOF_MIME_TYPES)[number]

export interface UploadConsentProofInput {
  restaurantId: string
  file: { bytes: Buffer; mimeType: string; originalName: string }
}

export interface UploadConsentProofResult {
  storagePath: string
  signedUrl: string
}

export async function uploadConsentProof(
  input: UploadConsentProofInput
): Promise<UploadConsentProofResult> {
  validateMime(input.file.mimeType)
  validateSize(input.file.bytes.length)

  const storagePath = buildStoragePath(input.restaurantId, input.file.mimeType)
  const supabase = createServerSupabaseClient()
  const bucket = supabase.storage.from(BUCKET)

  const { error: upErr } = await bucket.upload(storagePath, input.file.bytes, {
    contentType: input.file.mimeType,
    upsert: false,
  })
  if (upErr) throw new Error(`Proof upload failed: ${upErr.message}`)

  const { data, error: signErr } = await bucket.createSignedUrl(
    storagePath,
    SIGNED_URL_TTL_SECONDS
  )
  if (signErr || !data?.signedUrl) {
    throw new Error(
      `Failed to mint proof signed URL: ${signErr?.message ?? 'unknown'}`
    )
  }

  return { storagePath, signedUrl: data.signedUrl }
}

function validateMime(mime: string): void {
  if (!ALLOWED_PROOF_MIME_TYPES.includes(mime as ProofMimeType)) {
    throw new ProofUploadValidationError('unsupported_mime')
  }
}

function validateSize(bytes: number): void {
  if (bytes > MAX_BYTES) {
    throw new ProofUploadValidationError('file_too_large')
  }
}

function buildStoragePath(restaurantId: string, mime: string): string {
  return `${restaurantId}/${randomUUID()}.${extFromMime(mime)}`
}

function extFromMime(mime: string): string {
  if (mime === 'application/pdf') return 'pdf'
  const tail = mime.split('/')[1] ?? 'bin'
  return tail === 'jpeg' ? 'jpg' : tail
}
