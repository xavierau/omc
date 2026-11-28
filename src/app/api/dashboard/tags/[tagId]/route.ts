// TAG-001 — Stream B: rename/delete a single tag. Both pass restaurantId from
// getTenantContext() into the use-case, which scopes the write by restaurant_id
// (lazy-flow authorization parity) — a tagId from another tenant yields 404,
// never a cross-tenant mutation. The tagId in the path is never trusted alone.

import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { renameTag } from '@/application/rename-tag'
import { deleteTag } from '@/application/delete-tag'
import { mapTagRouteError } from '../_shared'

interface RouteParams {
  params: Promise<{ tagId: string }>
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { restaurantId } = await getTenantContext()
    const { tagId } = await params
    const body = (await request.json()) as { name?: unknown }
    const tag = await renameTag({
      restaurantId,
      tagId,
      name: typeof body.name === 'string' ? body.name : '',
    })
    return NextResponse.json(tag)
  } catch (error) {
    return mapTagRouteError(error, 'Tag rename API error')
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { restaurantId } = await getTenantContext()
    const { tagId } = await params
    await deleteTag({ restaurantId, tagId })
    return NextResponse.json({ success: true })
  } catch (error) {
    return mapTagRouteError(error, 'Tag delete API error')
  }
}
