// WAQ-011: POST /api/template-reviews
// Tenant-scoped submission. Authenticated user from the active tenant
// context submits a marketing template for review. Body:
//   { templateName, templateId?, targetAudienceSize?, targetAudienceQuery?,
//     contentPreview? }

import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { submitTemplateReview } from '@/application/submit-template-review'

const MAX_TEMPLATE_NAME_LEN = 512
const MAX_PREVIEW_LEN = 4000

export async function POST(request: NextRequest) {
  try {
    const { userId, restaurantId } = await getTenantContext()
    const parsed = await parseBody(request)
    if (!parsed.ok) return parsed.response

    const id = await submitTemplateReview({
      restaurantId,
      submittedBy: userId,
      templateName: parsed.templateName,
      templateId: parsed.templateId ?? null,
      targetAudienceSize: parsed.targetAudienceSize ?? null,
      targetAudienceQuery: parsed.targetAudienceQuery ?? null,
      contentPreview: parsed.contentPreview ?? null,
    })
    return NextResponse.json({ id, status: 'pending' }, { status: 201 })
  } catch (error) {
    return handleError(error, 'Template review submit error')
  }
}

interface ParsedSubmit {
  templateName: string
  templateId?: string
  targetAudienceSize?: number
  targetAudienceQuery?: Record<string, unknown>
  contentPreview?: string
}

type ParseResult =
  | ({ ok: true } & ParsedSubmit)
  | { ok: false; response: NextResponse }

async function parseBody(request: NextRequest): Promise<ParseResult> {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return { ok: false, response: bad('Body must be JSON') }
  }
  const b = body as Record<string, unknown>
  const name = b.templateName
  if (typeof name !== 'string' || name.trim().length === 0) {
    return { ok: false, response: bad('templateName is required') }
  }
  if (name.length > MAX_TEMPLATE_NAME_LEN) {
    return { ok: false, response: bad('templateName too long') }
  }
  const preview = b.contentPreview
  if (preview !== undefined && typeof preview !== 'string') {
    return { ok: false, response: bad('contentPreview must be a string') }
  }
  if (typeof preview === 'string' && preview.length > MAX_PREVIEW_LEN) {
    return { ok: false, response: bad('contentPreview too long') }
  }
  return {
    ok: true,
    templateName: name.trim(),
    templateId: typeof b.templateId === 'string' ? b.templateId : undefined,
    targetAudienceSize:
      typeof b.targetAudienceSize === 'number' ? b.targetAudienceSize : undefined,
    targetAudienceQuery:
      isPlainObject(b.targetAudienceQuery) ? b.targetAudienceQuery : undefined,
    contentPreview: typeof preview === 'string' ? preview : undefined,
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function bad(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 })
}

function handleError(error: unknown, label: string) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  if (error instanceof Error && /already exists/i.test(error.message)) {
    return NextResponse.json({ error: error.message }, { status: 409 })
  }
  console.error(`${label}:`, error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
