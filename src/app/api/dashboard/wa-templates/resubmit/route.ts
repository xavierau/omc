import { NextResponse } from 'next/server'
import {
  getMetaBusinessAccountId,
  updateMetaBusinessAccountId,
} from '@/infrastructure/supabase/repositories/restaurant-repository'
import { createMetaTemplate } from '@/infrastructure/kapso/template-client'
import {
  listTemplates,
  updateTemplate,
} from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'

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
  drafts: Array<{ id: string; name: string; language: string; category: string; components: unknown }>,
  wabaId: string
) {
  const results: Array<{ name: string; success: boolean; metaId?: string; error?: string }> = []

  for (const t of drafts) {
    try {
      const components = injectNamedParamExamples(
        t.components as Array<{ type: string; text?: string; [k: string]: unknown }>
      )
      const result = await createMetaTemplate(wabaId, {
        name: t.name,
        language: t.language,
        category: t.category,
        components,
        parameterFormat: 'NAMED',
      })
      if (result) {
        await updateTemplate(t.id, { metaTemplateId: result.id, status: 'pending' })
        results.push({ name: t.name, success: true, metaId: result.id })
      } else {
        results.push({ name: t.name, success: false, error: 'Meta returned null' })
      }
    } catch (err) {
      results.push({ name: t.name, success: false, error: (err as Error).message })
    }
  }

  return results
}

const EXAMPLE_VALUES: Record<string, string> = {
  customer_name: 'John',
  name: 'John',
  code: 'ABC123',
  discount: '20%',
}

function injectNamedParamExamples(
  components: Array<{ type: string; text?: string; example?: unknown; [k: string]: unknown }>
): Array<{ type: string; [k: string]: unknown }> {
  return components.map((c) => {
    if (c.type === 'BUTTONS') return injectButtonExamples(c)
    if (!c.text) return c
    return injectTextExamples(c)
  })
}

function injectButtonExamples(
  c: { type: string; buttons?: unknown; [k: string]: unknown }
) {
  const buttons = (c.buttons as Array<{ type: string; text: string; [k: string]: unknown }>) ?? []
  return {
    ...c,
    buttons: buttons.map((b) =>
      b.type === 'COPY_CODE' ? { ...b, text: 'Copy offer code' } : b
    ),
  }
}

function injectTextExamples(
  c: { type: string; text?: string; [k: string]: unknown }
) {
  const params = [...(c.text ?? '').matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1])
  if (params.length === 0) return c

  const key = c.type === 'HEADER' ? 'headerTextNamedParams' : 'bodyTextNamedParams'
  return {
    ...c,
    example: {
      [key]: params.map((p) => ({
        paramName: p,
        example: EXAMPLE_VALUES[p] ?? 'example',
      })),
    },
  }
}
