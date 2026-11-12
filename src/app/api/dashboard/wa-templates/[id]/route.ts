import { NextRequest, NextResponse } from 'next/server'
import { findTemplateByIdForRestaurant } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { deleteWhatsAppTemplate } from '@/application/delete-whatsapp-template'
import {
  updateWhatsAppTemplate,
  TemplateNotFoundError,
} from '@/application/update-whatsapp-template'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'

// Every handler scopes the template by the caller's restaurantId. The repository
// runs on the service-role client (RLS is not a backstop here), so this scoping is
// the only thing standing between a tenant and another tenant's templates. A
// foreign id answers 404, identically to a missing one, so ids stay non-enumerable.

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { restaurantId } = await getTenantContext()
    const { id } = await params
    const template = await findTemplateByIdForRestaurant(id, restaurantId)
    if (!template) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      )
    }
    return NextResponse.json(template)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Template GET error:', error)
    return NextResponse.json(
      { error: 'Failed to load template' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { restaurantId } = await getTenantContext()
    const { id } = await params
    const body = await request.json()
    const result = await updateWhatsAppTemplate(id, restaurantId, {
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
    return NextResponse.json(result.template)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    if (error instanceof TemplateNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    const message = error instanceof Error ? error.message : 'Failed to update template'
    console.error('Template PATCH error:', error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { restaurantId } = await getTenantContext()
    const { id } = await params
    const result = await deleteWhatsAppTemplate(id, restaurantId)
    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 404 }
      )
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Template DELETE error:', error)
    return NextResponse.json(
      { error: 'Failed to delete template' },
      { status: 500 }
    )
  }
}
