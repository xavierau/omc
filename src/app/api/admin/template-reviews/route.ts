// WAQ-011: GET /api/admin/template-reviews
// Lists pending template reviews across all tenants for the admin queue.
// Query: ?status=pending|approved|rejected|changes_requested (defaults
// to 'pending' since that's the action queue). Platform admin only.

import { NextRequest, NextResponse } from 'next/server'
import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import { listTemplateReviewsByStatus } from '@/infrastructure/supabase/repositories/template-review-repository'
import {
  isReviewStatus,
  type ReviewStatus,
} from '@/domain/value-objects/review-status'

export async function GET(request: NextRequest) {
  try {
    const { userId } = await assertPlatformAdmin()
    if (!checkAdminRateLimit(userId).success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const status = parseStatus(request)
    if (!status) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    const rows = await listTemplateReviewsByStatus({ status })
    return NextResponse.json({
      status,
      reviews: rows.map((r) => r.snapshot),
    })
  } catch (error) {
    return handleError(error, 'Template reviews list error')
  }
}

function parseStatus(request: NextRequest): ReviewStatus | null {
  const raw = request.nextUrl.searchParams.get('status') ?? 'pending'
  return isReviewStatus(raw) ? raw : null
}

function handleError(error: unknown, label: string) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  console.error(`${label}:`, error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
