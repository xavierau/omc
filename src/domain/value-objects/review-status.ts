// WAQ-011: lifecycle status of a `template_review_queue` row.
//
// `pending`           — submitted, awaiting platform-admin decision.
// `approved`          — admin-approved; the marketing send-time gate accepts this.
// `rejected`          — admin-rejected; tenant must submit a NEW row to retry.
// `changes_requested` — admin asked for edits; tenant must submit a NEW row.
//
// Note `pending` + `approved` are the "active" statuses (per the partial
// unique index in migration 044) — at most one of those at a time per
// (restaurant_id, template_name).

export type ReviewStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'changes_requested'

const STATUSES: readonly ReviewStatus[] = [
  'pending',
  'approved',
  'rejected',
  'changes_requested',
]

export function isReviewStatus(v: unknown): v is ReviewStatus {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v)
}

export const ACTIVE_REVIEW_STATUSES: readonly ReviewStatus[] = [
  'pending',
  'approved',
]
