import { NextRequest, NextResponse } from 'next/server'
import { listWhatsAppTemplates } from '@/application/list-whatsapp-templates'
import { createWhatsAppTemplate } from '@/application/create-whatsapp-template'
import type { TemplateStatus, TemplateCategory } from '@/domain/entities/whatsapp-template'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'

export async function GET(request: NextRequest) {
  try {
    const { restaurantId } = await getTenantContext()
    const params = request.nextUrl.searchParams
    const result = await listWhatsAppTemplates({
      restaurantId,
      status: (params.get('status') as TemplateStatus) ?? undefined,
      category: (params.get('category') as TemplateCategory) ?? undefined,
      page: params.get('page') ? Number(params.get('page')) : undefined,
      pageSize: params.get('pageSize') ? Number(params.get('pageSize')) : undefined,
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    const message = error instanceof Error ? error.message : 'Failed to load templates'
    console.error('Templates list API error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { restaurantId } = await getTenantContext()
    const body = await request.json()
    const validationError = validateCreateBody(body)
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    const result = await createWhatsAppTemplate({
      restaurantId,
      name: body.name,
      language: body.language,
      category: body.category,
      components: body.components,
    })

    if (result.errorCode) {
      return NextResponse.json(
        { template: result.template, error: result.error },
        { status: result.errorCode === 'meta_rejected' ? 422 : 502 }
      )
    }
    return NextResponse.json(result.template, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    const message = error instanceof Error ? error.message : 'Failed to create template'
    console.error('Template create API error:', error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

function validateCreateBody(body: Record<string, unknown>): string | null {
  if (!body.name || typeof body.name !== 'string') return 'name is required'
  if (!body.language || typeof body.language !== 'string') return 'language is required'
  if (!body.category || typeof body.category !== 'string') return 'category is required'
  if (!Array.isArray(body.components)) return 'components must be an array'
  return null
}
