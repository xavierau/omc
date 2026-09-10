import { createServerSupabaseClient } from '@/infrastructure/supabase/client'

const BUCKET = 'consent-proof'
const DEFAULT_TTL_SECONDS = 300

export async function resolveProofSignedUrl(
  storagePath: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): Promise<string> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, ttlSeconds)

  if (error) {
    throw new Error(`Failed to mint signed URL: ${error.message}`)
  }
  if (!data?.signedUrl) {
    throw new Error('Failed to mint signed URL: empty response')
  }
  return data.signedUrl
}
