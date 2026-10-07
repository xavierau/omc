/**
 * Client-side helpers for the member tags section. Isolated from the
 * component so vitest can cover the request/parse shape without RTL
 * (mirrors member-delete-helpers.ts).
 */
export interface MemberTag {
  id: string
  name: string
  color: string
}

export function memberTagsUrl(memberId: string): string {
  return `/api/dashboard/members/${memberId}/tags`
}

export function memberTagUrl(memberId: string, tagId: string): string {
  return `/api/dashboard/members/${memberId}/tags/${tagId}`
}

/** Tolerates both the `{ tags: [...] }` envelope and a bare array. */
export function parseMemberTags(body: unknown): MemberTag[] {
  if (Array.isArray(body)) return body as MemberTag[]
  if (body && typeof body === 'object' && Array.isArray((body as { tags?: unknown }).tags)) {
    return (body as { tags: MemberTag[] }).tags
  }
  return []
}

export async function fetchMemberTags(memberId: string): Promise<MemberTag[]> {
  const res = await fetch(memberTagsUrl(memberId))
  if (!res.ok) throw new Error(`Failed to load member tags (${res.status})`)
  return parseMemberTags(await res.json())
}

export async function assignMemberTags(memberId: string, tagIds: string[]): Promise<void> {
  const res = await fetch(memberTagsUrl(memberId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tagIds }),
  })
  if (!res.ok) throw new Error(`Failed to assign tags (${res.status})`)
}

export async function removeMemberTag(memberId: string, tagId: string): Promise<void> {
  const res = await fetch(memberTagUrl(memberId, tagId), { method: 'DELETE' })
  if (!res.ok) throw new Error(`Failed to remove tag (${res.status})`)
}
