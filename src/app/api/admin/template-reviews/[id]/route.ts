// WAQ-011: POST /api/admin/template-reviews/[id]
// Platform-admin decision endpoint. Body: { action, notes? }.
// Action values map 1:1 to the application-layer ReviewAction union.

import { NextRequest, NextResponse } from 'next/server'
import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import {
  reviewTemplate,
  type ReviewAction,
} from '@/application/review-template'
import { ForbiddenError } from '@/application/forbidden-error'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VALID_ACTIONS: readonly ReviewAction[] = [
  'approve',
  'reject',
  'request_changes',
]

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { userId } = await assertPlatformAdmin()
    if (!checkAdminRateLimit(userId).success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const { id } = await params
    if (!UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'Invalid review ID' }, { status: 400 })
    }
    const parsed = await parseBody(request)
    if (!parsed.ok) return parsed.response
    await reviewTemplate({
      reviewId: id,
      action: parsed.action,
      notes: parsed.notes,
      actor: { userId, role: 'platform_admin' },
    })
    return NextResponse.json({ status: 'reviewed', action: parsed.action })
  } catch (error) {
    return handleError(error, 'Template review decision error')
  }
}

type ParsedBody =
  | { ok: true; action: ReviewAction; notes?: string }
  | { ok: false; response: NextResponse }

async function parseBody(request: NextRequest): Promise<ParsedBody> {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return { ok: false, response: bad('Body must be JSON') }
  }
  const action = (body as { action?: string }).action
  if (!action || !(VALID_ACTIONS as readonly string[]).includes(action)) {
    return { ok: false, response: bad('Invalid action') }
  }
  const notes = (body as { notes?: string }).notes
  if (notes !== undefined && typeof notes !== 'string') {
    return { ok: false, response: bad('Notes must be a string') }
  }
  if (notes && notes.length > 2000) {
    return { ok: false, response: bad('Notes too long (max 2000 chars)') }
  }
  return { ok: true, action: action as ReviewAction, notes }
}

function bad(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 })
}

function handleError(error: unknown, label: string) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ error: error.message }, { status: 403 })
  }
  if (error instanceof Error && /not found/i.test(error.message)) {
    return NextResponse.json({ error: error.message }, { status: 404 })
  }
  if (error instanceof Error && /notes are required/i.test(error.message)) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  console.error(`${label}:`, error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
