// Issue #102 Part A: CampaignCard.handleExecute only checked res.ok, so a
// 403 guardrail block (or a template-review gate) read as success and the
// button stayed enabled with no explanation. These pure helpers turn the
// execute() error response and the WAQ-011 review-gate state into messages
// the card can render, kept out of the TSX per house style.

export interface ExecuteViolation {
  code?: string
  message?: string
}

interface ExecuteErrorBody {
  error?: string
  violations?: (string | ExecuteViolation)[]
}

async function readBody(res: Response): Promise<ExecuteErrorBody> {
  try {
    return (await res.json()) as ExecuteErrorBody
  } catch {
    return {}
  }
}

export function formatExecuteViolations(
  violations: (string | ExecuteViolation)[] | undefined
): string[] {
  return (violations ?? [])
    .map((v) => (typeof v === 'string' ? v : (v.message ?? v.code ?? '')))
    .filter((m): m is string => Boolean(m))
}

export async function readExecuteError(res: Response, fallback: string): Promise<string> {
  const body = await readBody(res)
  const messages = formatExecuteViolations(body.violations)
  if (messages.length > 0) return messages.join('; ')
  return body.error ?? fallback
}

export interface CampaignTemplateReviewGate {
  required: boolean
  status: 'none' | 'pending' | 'approved' | 'rejected' | 'changes_requested'
}

export type ReviewGateReasonKey = 'reviewRequiredPending' | 'reviewRequiredSubmit' | null

export function reviewGateReasonKey(
  gate?: CampaignTemplateReviewGate | null
): ReviewGateReasonKey {
  if (!gate?.required) return null
  if (gate.status === 'approved') return null
  return gate.status === 'pending' ? 'reviewRequiredPending' : 'reviewRequiredSubmit'
}
