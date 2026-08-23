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
