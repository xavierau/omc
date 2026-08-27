export interface TemplateButton {
  type: 'URL' | 'PHONE_NUMBER' | 'COUPON_URL' | 'QUICK_REPLY' | 'UNSUPPORTED'
  text: string
  url: string
  phoneNumber: string
  /**
   * Only set for UNSUPPORTED buttons: the original stored button object
   * (e.g. COPY_CODE), re-emitted unchanged on save rather than rewritten.
   */
  raw?: Record<string, unknown>
}

/**
 * Every field seeded, including the ones the current type hides: a button that
 * starts life without `phoneNumber` never gains one when the type switches, and
 * the key then vanishes from the request body (issue #97).
 */
export function createTemplateButton(): TemplateButton {
  return { type: 'URL', text: '', url: '', phoneNumber: '' }
}

/**
 * Changing the type drops the values that no longer apply, so a hidden url or
 * phone number from the previous type can never ride along to Meta.
 */
export function applyTemplateButtonChange(
  btn: TemplateButton,
  key: keyof TemplateButton,
  value: string
): TemplateButton {
  if (key !== 'type') return { ...btn, [key]: value }
  const type = value as TemplateButton['type']
  return {
    ...btn,
    type,
    url: type === 'URL' ? btn.url : '',
    phoneNumber: type === 'PHONE_NUMBER' ? btn.phoneNumber : '',
  }
}

/**
 * Blocks the button shapes Meta certainly rejects, naming the button so the
 * operator knows which box to fill. Returns a user-facing message, or null.
 */
export function validateWaTemplateButtons(buttons: TemplateButton[]): string | null {
  for (const [i, b] of buttons.entries()) {
    if (b.type === 'UNSUPPORTED') continue
    const name = `Button ${i + 1}`
    if (!(b.text ?? '').trim()) return `${name}: enter the label shown on the button`
    if (b.type === 'URL' && !(b.url ?? '').trim()) return `${name}: enter the link URL`
    if (b.type === 'PHONE_NUMBER' && !(b.phoneNumber ?? '').trim()) {
      return `${name}: enter the phone number, including its country code`
    }
  }
  return null
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

type StoredTemplateButton = {
  type: string
  text?: string
  url?: string
  phoneNumber?: string
  [key: string]: unknown
}

/**
 * Only maps stored types the form actually offers an editor for. Anything else
 * (COPY_CODE, or any type Meta introduces that this form doesn't know) round-trips
 * as UNSUPPORTED, carrying the original object so a save never rewrites it (#132).
 */
function parseButtons(c: Record<string, unknown>): TemplateButton[] {
  const raw = c.buttons as StoredTemplateButton[] | undefined
  return (raw ?? []).map((b) => {
    const isCouponUrl = b.type === 'URL' && b.url?.includes('/coupon/')
    if (isCouponUrl) return { type: 'COUPON_URL', text: b.text ?? '', url: '', phoneNumber: '' }
    if (b.type === 'URL') return { type: 'URL', text: b.text ?? '', url: b.url ?? '', phoneNumber: '' }
    if (b.type === 'PHONE_NUMBER') {
      return { type: 'PHONE_NUMBER', text: b.text ?? '', url: '', phoneNumber: b.phoneNumber ?? '' }
    }
    if (b.type === 'QUICK_REPLY') return { type: 'QUICK_REPLY', text: b.text ?? '', url: '', phoneNumber: '' }
    return { type: 'UNSUPPORTED', text: b.text ?? '', url: '', phoneNumber: '', raw: b }
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
        if (b.type === 'UNSUPPORTED') return b.raw
        // `?? ''` keeps the key on the wire when the value is missing: an
        // undefined drops it entirely, and the server backstop then sees a
        // phone button that merely looks number-less by design (#97).
        return {
          type: b.type,
          text: b.text,
          ...(b.type === 'URL' ? { url: b.url ?? '' } : {}),
          ...(b.type === 'PHONE_NUMBER' ? { phoneNumber: b.phoneNumber ?? '' } : {}),
        }
      }),
    })
  }
  return {
    name: form.name, language: form.language,
    category: form.category, components,
  }
}
