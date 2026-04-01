import { NextRequest, NextResponse } from 'next/server'
import { findTemplateById } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { deleteWhatsAppTemplate } from '@/application/delete-whatsapp-template'
import { updateWhatsAppTemplate } from '@/application/update-whatsapp-template'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await getTenantContext()
    const { id } = await params
    const template = await findTemplateById(id)
    if (!template) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      )
    }
    return NextResponse.json(template)
  } catch (error) {
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
    await getTenantContext()
    const { id } = await params
    const body = await request.json()
    const result = await updateWhatsAppTemplate(id, {
      name: body.name,
      language: body.language,
      category: body.category,
      components: body.components,
    })

    if (result.error) {
      return NextResponse.json(
        { template: result.template, warning: result.error },
        { status: 200 }
      )
    }
    return NextResponse.json(result.template)
  } catch (error) {
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
    await getTenantContext()
    const { id } = await params
    const result = await deleteWhatsAppTemplate(id)
    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 404 }
      )
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Template DELETE error:', error)
    return NextResponse.json(
      { error: 'Failed to delete template' },
      { status: 500 }
    )
  }
}
