import {
  findExistingMemberPhones,
  findActiveMarketingConsentPhones,
} from '@/infrastructure/supabase/repositories/import-preview-lookups'

/** Above this many accepted rows, the DB pre-check is skipped (R-6). */
export const PREVIEW_LOOKUP_MAX_ROWS = 5000

export interface PreviewLookups {
  alreadyMemberPhones: string[]
  activeConsentPhones: string[]
  status: 'ok' | 'skipped_too_many_rows' | 'failed'
}

const EMPTY_SETS = { alreadyMemberPhones: [] as string[], activeConsentPhones: [] as string[] }

/**
 * Advisory, read-only pre-check for the import preview step (#139.2). Never
 * blocks the preview (AD-5): degrades to 'skipped_too_many_rows' above the
 * row cap and to 'failed' on any repository error, logging server-side —
 * the preview still returns its grade breakdown and syntactic rejections.
 */
export async function runPreviewLookups(
  restaurantId: string,
  phones: string[]
): Promise<PreviewLookups> {
  if (phones.length === 0) return { ...EMPTY_SETS, status: 'ok' }
  if (phones.length > PREVIEW_LOOKUP_MAX_ROWS) {
    return { ...EMPTY_SETS, status: 'skipped_too_many_rows' }
  }
  try {
    // Serial, not Promise.all: each lookup already runs MAX_CONCURRENT_CHUNKS
    // (4) chunk queries in parallel, so racing the two put 8 connections in
    // flight against a documented budget of 4 (review M-3).
    const alreadyMember = await findExistingMemberPhones(restaurantId, phones)
    const activeConsent = await findActiveMarketingConsentPhones(restaurantId, phones)
    return {
      alreadyMemberPhones: Array.from(alreadyMember),
      activeConsentPhones: Array.from(activeConsent),
      status: 'ok',
    }
  } catch (error) {
    console.error('Preview DB lookups failed (degrading OFF):', error)
    return { ...EMPTY_SETS, status: 'failed' }
  }
}
