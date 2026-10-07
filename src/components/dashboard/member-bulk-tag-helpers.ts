/**
 * TAG-001 F4 — client helpers for the members-list bulk tag/untag bar.
 * Posts to POST /api/dashboard/members/bulk-tags (B3 contract: 200 { affected }
 * | 400 shape/cap | 403 cross-tenant tag or member | 401 auth | 5xx). The
 * 500-member / 20-tag caps are enforced HERE, before any request goes out, so
 * a cap violation never reaches the server (any other 400 the server does
 * return still maps to the generic failure copy).
 */
import type { Tag } from '@/domain/entities/tag'

const ENDPOINT = '/api/dashboard/members/bulk-tags'

export const MAX_BULK_MEMBERS = 500
export const MAX_BULK_TAGS = 20

export type BulkTagAction = 'add' | 'remove'
export type BulkTagErrorKey = 'bulkTagForbidden' | 'bulkTagTooMany' | 'bulkTagFailed'

export interface BulkUpdateMemberTagsParams {
  memberIds: string[]
  tagIds: string[]
  action: BulkTagAction
}

export interface BulkUpdateMemberTagsResult {
  ok: boolean
  affected?: number
  errorKey?: BulkTagErrorKey
}

export async function bulkUpdateMemberTags(
  params: BulkUpdateMemberTagsParams
): Promise<BulkUpdateMemberTagsResult> {
  if (params.memberIds.length > MAX_BULK_MEMBERS || params.tagIds.length > MAX_BULK_TAGS) {
    return { ok: false, errorKey: 'bulkTagTooMany' }
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })

    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { affected?: unknown }
      const affected = typeof body.affected === 'number' ? body.affected : 0
      return { ok: true, affected }
    }

    if (res.status === 403) return { ok: false, errorKey: 'bulkTagForbidden' }
    return { ok: false, errorKey: 'bulkTagFailed' }
  } catch {
    return { ok: false, errorKey: 'bulkTagFailed' }
  }
}

/**
 * Pure: resolve selected tag ids to their display names for the success-line
 * copy ({tags} placeholder). Ids with no match (shouldn't happen — the ids
 * come from the same TagCombobox fetch) are silently skipped rather than
 * breaking the sentence.
 */
export function joinTagNames(tagIds: string[], tags: Pick<Tag, 'id' | 'name'>[]): string {
  return tagIds
    .map((id) => tags.find((tag) => tag.id === id)?.name)
    .filter((name): name is string => Boolean(name))
    .join(', ')
}
