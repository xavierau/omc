// WAQ-011 admin decision: posts an approve/reject/request_changes decision
// for a template review and interprets the response. Colocated fetch helper,
// same shape as referrer-form-helpers.ts / wa-template-submit.ts.

export type ReviewDecisionAction = 'approve' | 'reject' | 'request_changes'

export interface ReviewDecisionOutcome {
  ok: boolean
  error: string | null
}

export function decisionNeedsNotes(action: ReviewDecisionAction): boolean {
  return action === 'reject' || action === 'request_changes'
}

interface DecisionErrorBody {
  error?: string
}

async function readBody(res: Response): Promise<DecisionErrorBody> {
  try {
    return (await res.json()) as DecisionErrorBody
  } catch {
    return {}
  }
}

export async function submitTemplateReviewDecision(
  id: string,
  action: ReviewDecisionAction,
  notes: string,
  fallback: string
): Promise<ReviewDecisionOutcome> {
  try {
    const res = await fetch(`/api/admin/template-reviews/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, notes: notes.trim() || undefined }),
    })
    if (res.ok) return { ok: true, error: null }
    const body = await readBody(res)
    return { ok: false, error: body.error ?? fallback }
  } catch {
    return { ok: false, error: fallback }
  }
}

export interface RunDecisionArgs {
  reviewId: string
  action: ReviewDecisionAction
  notes: string
  fallback: string
  submit: typeof submitTemplateReviewDecision
  onDecided: () => void
}

// PR #108 review: a second admin deciding an already-decided review (the
// "two-admins race" — this sheet still shows a stale review.status ===
// 'pending' snapshot) makes the domain throw and the route 500. There is no
// way to detect that client-side ahead of time, so instead we always
// refetch the list after a decision attempt — success or failure — so a
// race self-corrects on the next view instead of leaving a stale row behind
// a misleading "try again" message. Kept framework-free (submit/onDecided
// injected) so the refetch-on-failure behavior is unit-testable without
// mounting the stateful sheet.
export async function runTemplateReviewDecision(
  args: RunDecisionArgs
): Promise<ReviewDecisionOutcome> {
  const outcome = await args.submit(args.reviewId, args.action, args.notes, args.fallback)
  args.onDecided()
  return outcome
}
