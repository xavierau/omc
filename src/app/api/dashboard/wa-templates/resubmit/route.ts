import { NextResponse } from 'next/server'
import {
  getMetaBusinessAccountId,
  updateMetaBusinessAccountId,
} from '@/infrastructure/supabase/repositories/restaurant-repository'
import { createMetaTemplate } from '@/infrastructure/whatsapp/templates'
import {
  listTemplates,
  updateTemplate,
} from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { prepareTemplateComponents } from '@/domain/services/prepare-template-components'
import { validateTemplateComponents } from '@/domain/services/validate-template-components'
import type { TemplateComponent } from '@/domain/entities/whatsapp-template'

export async function POST() {
  try {
    const { restaurantId } = await getTenantContext()
    let wabaId = await getMetaBusinessAccountId(restaurantId)

    if (!wabaId) {
      const KAPSO_WABA_ID = '1352084526373366'
      wabaId = KAPSO_WABA_ID
      await updateMetaBusinessAccountId(restaurantId, wabaId)
    }

    const { templates } = await listTemplates({
      restaurantId,
      page: 1,
      pageSize: 100,
    })

    const drafts = templates.filter((t) => !t.metaTemplateId)
    const results = await submitDrafts(drafts, wabaId)

    return NextResponse.json({ wabaId, submitted: results })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}

async function submitDrafts(
  drafts: Array<{ id: string; name: string; language: string; category: string; components: TemplateComponent[] }>,
  wabaId: string
) {
  const results: Array<{ name: string; success: boolean; metaId?: string; error?: string }> = []

  for (const t of drafts) {
    try {
      const validationError = validateTemplateComponents(t.components)
      if (validationError) {
        results.push({ name: t.name, success: false, error: validationError })
        continue
      }

      const result = await createMetaTemplate(wabaId, {
        name: t.name,
        language: t.language,
        category: t.category,
        components: prepareTemplateComponents(t.components),
        parameterFormat: 'NAMED',
      })
      if (result.ok) {
        await updateTemplate(t.id, { metaTemplateId: result.templateId, status: 'pending' })
        results.push({ name: t.name, success: true, metaId: result.templateId ?? undefined })
      } else {
        const error =
          result.error?.details ?? result.error?.title ?? 'Failed to submit template to Meta'
        // Only a refusal Meta actually issued brands the row; a skip or a transient
        // failure leaves the draft untouched.
        if (result.error?.title === 'meta_rejected') {
          await updateTemplate(t.id, { status: 'rejected', rejectionReason: error })
        }
        results.push({ name: t.name, success: false, error })
      }
    } catch (err) {
      results.push({ name: t.name, success: false, error: (err as Error).message })
    }
  }

  return results
}
