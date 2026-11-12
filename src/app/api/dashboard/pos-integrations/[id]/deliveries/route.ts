import { NextRequest, NextResponse } from 'next/server'
import { getIntegration } from '@/application/configure-pos-integration'
import { listIntegrationDeliveries } from '@/application/list-integration-deliveries'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { requireTenantAdmin } from '@/infrastructure/supabase/guards/require-tenant-admin'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import type { IntegrationDeliveryStatus } from '@/domain/entities/integration-delivery'

type RouteContext = { params: Promise<{ id: string }> }

const VALID_STATUSES: readonly IntegrationDeliveryStatus[] = [
  'queued',
  'delivering',
  'retrying',
  'delivered',
  'dead_lettered',
  'paused',
  'skipped',
]

function isValidStatus(value: string | null): value is IntegrationDeliveryStatus {
  return value !== null && (VALID_STATUSES as readonly string[]).includes(value)
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const ctx = await getTenantContext()
    requireTenantAdmin(ctx)
    const { id } = await context.params
    const integration = await getIntegration(id, ctx.restaurantId)
    if (!integration) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const statusParam = request.nextUrl.searchParams.get('status')
    const status = isValidStatus(statusParam) ? statusParam : undefined
    const cursor = request.nextUrl.searchParams.get('cursor') ?? undefined

    const result = await listIntegrationDeliveries(id, ctx.restaurantId, { status, cursor })
    return NextResponse.json({ data: result.data, nextCursor: result.nextCursor })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Integration deliveries GET error:', error)
    return NextResponse.json({ error: 'Failed to load deliveries' }, { status: 500 })
  }
}
