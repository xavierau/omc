import { describe, it, expect, vi, beforeEach } from 'vitest'
import { extractTemplateBodyText, submitTemplateForReview } from '@/components/dashboard/template-review-submit'

describe('extractTemplateBodyText', () => {
  it('returns the BODY component text', () => {
    const components = [
      { type: 'HEADER', format: 'TEXT', text: 'Hello' },
      { type: 'BODY', text: 'Come back for 20% off!' },
      { type: 'FOOTER', text: 'Reply STOP to opt out' },
    ]
    expect(extractTemplateBodyText(components)).toBe('Come back for 20% off!')
  })

  it('returns an empty string when there is no BODY component', () => {
    expect(extractTemplateBodyText([{ type: 'HEADER', format: 'TEXT', text: 'Hi' }])).toBe('')
  })

  it('returns an empty string when BODY has no text', () => {
    expect(extractTemplateBodyText([{ type: 'BODY' }])).toBe('')
  })

  it('truncates to 4000 chars', () => {
    const long = 'a'.repeat(5000)
    expect(extractTemplateBodyText([{ type: 'BODY', text: long }])).toHaveLength(4000)
  })
})

describe('submitTemplateForReview', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('posts to /api/template-reviews with the expected body', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ status: 201 })
    vi.stubGlobal('fetch', fetchSpy)
    await submitTemplateForReview({
      templateName: '5th_anniversary',
      templateId: 'tpl-1',
      contentPreview: 'Come back!',
    })
    expect(fetchSpy).toHaveBeenCalledWith('/api/template-reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateName: '5th_anniversary',
        templateId: 'tpl-1',
        contentPreview: 'Come back!',
      }),
    })
  })

  it('omits an empty contentPreview from the request body', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ status: 201 })
    vi.stubGlobal('fetch', fetchSpy)
    await submitTemplateForReview({ templateName: 'n', templateId: 't', contentPreview: '' })
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(body.contentPreview).toBeUndefined()
  })

  it('reports submitted on 201', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 201 }))
    const outcome = await submitTemplateForReview({ templateName: 'n', templateId: 't', contentPreview: '' })
    expect(outcome).toEqual({ status: 'submitted' })
  })

  it('reports already_submitted on 409', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 409 }))
    const outcome = await submitTemplateForReview({ templateName: 'n', templateId: 't', contentPreview: '' })
    expect(outcome).toEqual({ status: 'already_submitted' })
  })

  it('reports error on other non-2xx statuses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 400 }))
    const outcome = await submitTemplateForReview({ templateName: 'n', templateId: 't', contentPreview: '' })
    expect(outcome).toEqual({ status: 'error' })
  })

  it('reports error when the fetch itself throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const outcome = await submitTemplateForReview({ templateName: 'n', templateId: 't', contentPreview: '' })
    expect(outcome).toEqual({ status: 'error' })
  })
})
