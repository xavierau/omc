/**
 * REPLY-008: public submit endpoint for the web contact form.
 *
 * Unauthenticated by necessity — the customer is a WhatsApp user, not an app
 * user. The one-off token in the body is the whole of the authorisation, and
 * it is claimed atomically before any work happens (see
 * `submitContactWebForm`).
 */
import { NextRequest, NextResponse } from 'next/server'
import { submitContactWebForm } from '@/application/submit-contact-web-form'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  // Consumed so the route's shape matches the page it serves; the tenant is
  // resolved from the TOKEN, never from this slug. A caller who swaps the slug
  // therefore cannot redirect an enquiry into another tenant's inbox.
  await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const token =
    typeof body === 'object' && body !== null
      ? (body as { token?: unknown }).token
      : undefined
  if (typeof token !== 'string' || !token) {
    return NextResponse.json({ error: 'missing_token' }, { status: 400 })
  }

  const result = await submitContactWebForm(token, body)
  if (result.ok) {
    return NextResponse.json({ ok: true })
  }

  // 410 Gone, distinctly from 400: it is the one outcome the client must treat
  // as terminal (stop offering the form, show the recovery link) rather than
  // as a fixable input error.
  if (result.reason === 'token_unusable') {
    return NextResponse.json({ error: 'token_unusable' }, { status: 410 })
  }
  if (result.reason === 'invalid_submission') {
    return NextResponse.json({ error: result.detail ?? 'invalid_submission' }, { status: 400 })
  }

  console.warn('[ContactForm] web submission failed:', result.detail)
  return NextResponse.json({ error: 'submission_failed' }, { status: 500 })
}
