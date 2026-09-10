import type { Member } from '@/domain/entities/member'

// WAQ-010: order recipients by engagement so the probe targets the most
// active tier. Members with `lastVisitAt = null` (no recorded visit) sort
// LAST — they are least engaged and least worth burning probe budget on.
//
// The sort is non-mutating; the caller keeps its array untouched.
// ISO-8601 strings sort lexically the same as chronologically, so we compare
// them directly without parsing into Date objects.
export function sortByEngagementTier(members: Member[]): Member[] {
  return [...members].sort(compareByLastVisitDesc)
}

function compareByLastVisitDesc(a: Member, b: Member): number {
  const aVal = a.lastVisitAt
  const bVal = b.lastVisitAt
  if (aVal === bVal) return 0
  // Nulls go last regardless of ordering direction.
  if (aVal === null) return 1
  if (bVal === null) return -1
  // Descending: larger ISO string (more recent) wins.
  if (aVal > bVal) return -1
  if (aVal < bVal) return 1
  return 0
}
