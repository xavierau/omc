import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import {
  assertTagsBelongToTenant,
  CrossTenantTagError,
} from '@/infrastructure/supabase/repositories/member-tag-repository'
import { countActiveMembersByTags } from '@/infrastructure/supabase/repositories/tag-audience-repository'

const MAX_TAG_IDS = 20

/**
 * Live recipient count for campaign tag-targeting (#138b, migration 067).
 * `assertTagsBelongToTenant` runs BEFORE the count so a foreign or deleted
 * tag id returns 403, never a silent 0 (A11).
 */
export async function GET(request: NextRequest) {
  try {
    const { restaurantId } = await getTenantContext()
    const tagIds = parseTagIdsParam(request.nextUrl.searchParams.get('tagIds'))
    if (!tagIds) {
      return NextResponse.json(
        { error: `tagIds must be 1-${MAX_TAG_IDS} comma-separated ids` },
        { status: 400 }
      )
    }
    await assertTagsBelongToTenant(tagIds, restaurantId)
    const count = await countActiveMembersByTags(tagIds, restaurantId)
    return NextResponse.json({ count })
  } catch (error) {
    return mapError(error)
  }
}

function parseTagIdsParam(raw: string | null): string[] | null {
  if (!raw) return null
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  if (ids.length === 0 || ids.length > MAX_TAG_IDS) return null
  return ids
}

function mapError(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  if (error instanceof CrossTenantTagError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  console.error('Recipient count API error:', error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
