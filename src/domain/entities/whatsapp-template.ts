export type TemplateCategory = 'MARKETING' | 'UTILITY'

export type TemplateStatus =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'paused'
  | 'disabled'
  | 'deleted'

export type HeaderFormat = 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT'

export type TemplateButtonType =
  | 'QUICK_REPLY'
  | 'URL'
  | 'PHONE_NUMBER'
  | 'COPY_CODE'

export interface TemplateButton {
  type: TemplateButtonType
  text: string
  url?: string
  phoneNumber?: string
  example?: string
}

export interface TemplateComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS'
  format?: HeaderFormat
  text?: string
  example?: {
    /**
     * Media header handle. Stored rows carry it under either key: `headerHandle`
     * from this entity, `header_handle` from the dashboard form
     * (wa-template-form-types.ts). Readers must accept both; submitters emit only
     * the camelCase shape, which the Kapso SDK snake-cases onto the wire.
     */
    headerHandle?: string[]
    header_handle?: string[]
    bodyText?: string[][]
  }
  buttons?: TemplateButton[]
}

export interface WhatsAppTemplate {
  id: string
  restaurantId: string
  metaTemplateId: string | null
  name: string
  language: string
  category: TemplateCategory
  status: TemplateStatus
  components: TemplateComponent[]
  parameterFormat: 'NAMED'
  rejectionReason: string | null
  createdAt: string
  updatedAt: string
}

export function isTemplateSendable(t: WhatsAppTemplate): boolean {
  return t.status === 'approved'
}

export function extractParameters(t: WhatsAppTemplate): string[] {
  const params = new Set<string>()
  const regex = /\{\{(\w+)\}\}/g

  for (const component of t.components) {
    if (!component.text) continue
    let match: RegExpExecArray | null
    while ((match = regex.exec(component.text)) !== null) {
      params.add(match[1])
    }
  }

  return Array.from(params)
}

export function validateTemplateName(name: string): boolean {
  if (name.length < 1 || name.length > 512) return false
  return /^[a-z0-9_]+$/.test(name)
}
