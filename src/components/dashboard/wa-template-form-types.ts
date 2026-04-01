export interface TemplateButton {
  type: 'URL' | 'PHONE_NUMBER' | 'COUPON_URL'
  text: string
  url: string
  phoneNumber: string
}

export interface WaTemplateFormState {
  name: string
  language: string
  category: string
  headerType: 'none' | 'text' | 'image'
  headerText: string
  headerImageUrl: string
  body: string
  footer: string
  buttons: TemplateButton[]
}

export const initialWaTemplateForm: WaTemplateFormState = {
  name: '', language: 'en', category: 'MARKETING',
  headerType: 'none', headerText: '', headerImageUrl: '',
  body: '', footer: '', buttons: [],
}

export function templateToFormState(
  t: { name: string; language: string; category: string; components: Record<string, unknown>[] }
): WaTemplateFormState {
  const state: WaTemplateFormState = { ...initialWaTemplateForm, name: t.name, language: t.language, category: t.category }
  for (const c of t.components) {
    if (c.type === 'HEADER' && c.format === 'TEXT') { state.headerType = 'text'; state.headerText = (c.text as string) ?? '' }
    else if (c.type === 'HEADER' && c.format === 'IMAGE') { state.headerType = 'image'; state.headerImageUrl = extractImageUrl(c) }
    else if (c.type === 'BODY') { state.body = (c.text as string) ?? '' }
    else if (c.type === 'FOOTER') { state.footer = (c.text as string) ?? '' }
    else if (c.type === 'BUTTONS') { state.buttons = parseButtons(c) }
  }
  return state
}

function extractImageUrl(c: Record<string, unknown>): string {
  const example = c.example as Record<string, unknown> | undefined
  const handles = example?.header_handle as string[] | undefined
  return handles?.[0] ?? ''
}

function parseButtons(c: Record<string, unknown>): TemplateButton[] {
  const raw = c.buttons as { type: string; text: string; url?: string; phoneNumber?: string }[] | undefined
  return (raw ?? []).map((b) => {
    const isCouponUrl = b.type === 'URL' && b.url?.includes('/coupon/')
    return {
      type: (isCouponUrl ? 'COUPON_URL' : b.type) as TemplateButton['type'],
      text: b.text ?? '',
      url: isCouponUrl ? '' : (b.url ?? ''),
      phoneNumber: b.phoneNumber ?? '',
    }
  })
}

export function buildWaTemplateRequestBody(form: WaTemplateFormState) {
  const components: Record<string, unknown>[] = []
  if (form.headerType === 'text') {
    components.push({ type: 'HEADER', format: 'TEXT', text: form.headerText })
  } else if (form.headerType === 'image') {
    components.push({
      type: 'HEADER', format: 'IMAGE',
      example: { header_handle: [form.headerImageUrl] },
    })
  }
  components.push({ type: 'BODY', text: form.body })
  if (form.footer.trim()) {
    components.push({ type: 'FOOTER', text: form.footer })
  }
  if (form.buttons.length > 0) {
    components.push({
      type: 'BUTTONS',
      buttons: form.buttons.map((b) => {
        if (b.type === 'COUPON_URL') {
          const baseUrl = process.env.NEXT_PUBLIC_APP_URL || ''
          return {
            type: 'URL' as const,
            text: b.text,
            url: `${baseUrl}/coupon/{{1}}`,
            example: [`${baseUrl}/coupon/SAMPLE123`],
          }
        }
        return {
          type: b.type,
          text: b.text,
          ...(b.type === 'URL' ? { url: b.url } : {}),
          ...(b.type === 'PHONE_NUMBER' ? { phoneNumber: b.phoneNumber } : {}),
        }
      }),
    })
  }
  return {
    name: form.name, language: form.language,
    category: form.category, components,
  }
}
