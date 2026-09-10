// TAG-001 — Stream B: tag CRUD list/create endpoints.
// GET  → listTags(restaurantId) for the tag manager.
// POST → createTag({name, color?}); 409 on a case-insensitively duplicate name.
// Tenant comes from getTenantContext(); the use-case/repo scope every write.

import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { createTag } from '@/application/create-tag'
import { listTags } from '@/application/list-tags'
import { mapTagRouteError } from './_shared'

export async function GET() {
  try {
    const { restaurantId } = await getTenantContext()
    const tags = await listTags(restaurantId)
    return NextResponse.json({ tags })
  } catch (error) {
    return mapTagRouteError(error, 'Tags list API error')
  }
}

export async function POST(request: NextRequest) {
  try {
    const { restaurantId } = await getTenantContext()
    const body = (await request.json()) as { name?: unknown; color?: unknown }
    const tag = await createTag({
      restaurantId,
      name: typeof body.name === 'string' ? body.name : '',
      color: typeof body.color === 'string' ? body.color : undefined,
    })
    return NextResponse.json(tag, { status: 201 })
  } catch (error) {
    return mapTagRouteError(error, 'Tag create API error')
  }
}
