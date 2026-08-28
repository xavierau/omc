// WAQ-011 tenant-side submit: turns a WA template row into a template-review
// request and interprets the response. Colocated with the table like
// wa-template-submit.ts to keep the row action's fetch logic out of the TSX.

export type TemplateReviewSubmitStatus = 'submitted' | 'already_submitted' | 'error'

export interface TemplateReviewSubmitOutcome {
  status: TemplateReviewSubmitStatus
}

interface SubmitReviewInput {
  templateName: string
  templateId: string
  contentPreview: string
}

const MAX_PREVIEW_LEN = 4000

export function extractTemplateBodyText(components: Record<string, unknown>[]): string {
  const body = components.find((c) => c.type === 'BODY')
  const text = body?.text
  return typeof text === 'string' ? text.slice(0, MAX_PREVIEW_LEN) : ''
}

export async function submitTemplateForReview(
  input: SubmitReviewInput
): Promise<TemplateReviewSubmitOutcome> {
  try {
    const res = await fetch('/api/template-reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateName: input.templateName,
        templateId: input.templateId,
        contentPreview: input.contentPreview || undefined,
      }),
    })
    if (res.status === 201) return { status: 'submitted' }
    if (res.status === 409) return { status: 'already_submitted' }
    return { status: 'error' }
  } catch {
    return { status: 'error' }
  }
}
