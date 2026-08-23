import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  decisionNeedsNotes,
  submitTemplateReviewDecision,
  runTemplateReviewDecision,
} from '@/components/admin/template-review-decision'

const FALLBACK = "Couldn't submit the decision."

describe('decisionNeedsNotes', () => {
  it('does not require notes to approve', () => {
    expect(decisionNeedsNotes('approve')).toBe(false)
  })
  it('requires notes to reject', () => {
    expect(decisionNeedsNotes('reject')).toBe(true)
  })
  it('requires notes to request changes', () => {
    expect(decisionNeedsNotes('request_changes')).toBe(true)
  })
})

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('submitTemplateReviewDecision', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('posts action + trimmed notes to the review endpoint', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(200, { status: 'reviewed' }))
    vi.stubGlobal('fetch', fetchSpy)
    await submitTemplateReviewDecision('review-1', 'reject', '  needs a discount cap  ', FALLBACK)
    expect(fetchSpy).toHaveBeenCalledWith('/api/admin/template-reviews/review-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject', notes: 'needs a discount cap' }),
    })
  })

  it('omits notes entirely when blank', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(200, { status: 'reviewed' }))
    vi.stubGlobal('fetch', fetchSpy)
    await submitTemplateReviewDecision('review-1', 'approve', '   ', FALLBACK)
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(body.notes).toBeUndefined()
  })

  it('reports ok on a 200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { status: 'reviewed' })))
    const outcome = await submitTemplateReviewDecision('review-1', 'approve', '', FALLBACK)
    expect(outcome).toEqual({ ok: true, error: null })
  })

  it('surfaces the server error message on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(400, { error: 'notes are required' }))
    )
    const outcome = await submitTemplateReviewDecision('review-1', 'reject', '', FALLBACK)
    expect(outcome).toEqual({ ok: false, error: 'notes are required' })
  })

  it('falls back to the generic message when the failure body has no error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, {})))
    const outcome = await submitTemplateReviewDecision('review-1', 'approve', '', FALLBACK)
    expect(outcome).toEqual({ ok: false, error: FALLBACK })
  })

  it('falls back to the generic message when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const outcome = await submitTemplateReviewDecision('review-1', 'approve', '', FALLBACK)
    expect(outcome).toEqual({ ok: false, error: FALLBACK })
  })
})

describe('runTemplateReviewDecision', () => {
  it('refetches the list on success', async () => {
    const onDecided = vi.fn()
    const submit = vi.fn().mockResolvedValue({ ok: true, error: null })
    const result = await runTemplateReviewDecision({
      reviewId: 'review-1', action: 'approve', notes: '', fallback: FALLBACK, submit, onDecided,
    })
    expect(onDecided).toHaveBeenCalledOnce()
    expect(result).toEqual({ ok: true, error: null })
  })

  it('still refetches the list when the decision fails (the two-admins race self-corrects)', async () => {
    const onDecided = vi.fn()
    const submit = vi.fn().mockResolvedValue({ ok: false, error: 'TemplateReview: cannot approve from status=\'approved\'' })
    const result = await runTemplateReviewDecision({
      reviewId: 'review-1', action: 'approve', notes: '', fallback: FALLBACK, submit, onDecided,
    })
    expect(onDecided).toHaveBeenCalledOnce()
    expect(result).toEqual({ ok: false, error: "TemplateReview: cannot approve from status='approved'" })
  })

  it('passes the reviewId/action/notes/fallback through to submit', async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true, error: null })
    await runTemplateReviewDecision({
      reviewId: 'review-9', action: 'reject', notes: 'bad copy', fallback: FALLBACK, submit, onDecided: () => {},
    })
    expect(submit).toHaveBeenCalledWith('review-9', 'reject', 'bad copy', FALLBACK)
  })
})
