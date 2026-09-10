// TAG-001 (B3): bulk tag/untag from the members list selection bar (AD-7).
// A static segment, so Next.js matches this before `[id]/tags`.

import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import {
  bulkUpdateMemberTags,
  BulkMemberTagValidationError,
  type BulkMemberTagAction,
} from '@/application/bulk-update-member-tags'
import { translateMemberTagError } from '../[id]/tags/route-errors'
import { isUuidArray } from '@/infrastructure/validation/validators'

export async function POST(request: NextRequest) {
  try {
    const { restaurantId } = await getTenantContext()
    const body = (await request.json()) as {
      memberIds?: unknown
      tagIds?: unknown
      action?: unknown
    }

    if (!isUuidArray(body.memberIds)) {
      return badRequest('memberIds must be an array of UUIDs')
    }
    if (!isUuidArray(body.tagIds)) {
      return badRequest('tagIds must be an array of UUIDs')
    }
    if (!isKnownAction(body.action)) {
      return badRequest("action must be 'add' or 'remove'")
    }

    const result = await bulkUpdateMemberTags({
      restaurantId,
      memberIds: body.memberIds,
      tagIds: body.tagIds,
      action: body.action,
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof BulkMemberTagValidationError) {
      return badRequest(error.message)
    }
    return translateMemberTagError(error)
  }
}

function isKnownAction(value: unknown): value is BulkMemberTagAction {
  return value === 'add' || value === 'remove'
}

function badRequest(error: string): NextResponse {
  return NextResponse.json({ error }, { status: 400 })
}
