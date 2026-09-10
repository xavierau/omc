export interface CampaignFormState {
  name: string
  type: string
  templateEn: string
  templateZhHk: string
  imageUrlEn: string
  imageUrlZhHk: string
  messageType: 'inline' | 'wa_template'
  whatsappTemplateId: string
  discountType: string
  discountValue: string
  expiresInDays: string
  execution: 'now' | 'schedule'
  scheduledAt: string
  targetAudience: 'all' | 'selected' | 'tag'
  memberIds: string[]
  tagIds: string[]
}

export const CAMPAIGN_TEMPLATE_PLACEHOLDERS = [
  '{{contactName}}',
  '{{couponCode}}',
  '{{greeting}}',
  '{{points}}',
] as const

export const initialCampaignForm: CampaignFormState = {
  name: '',
  type: 'winback',
  templateEn: '',
  templateZhHk: '',
  imageUrlEn: '',
  imageUrlZhHk: '',
  messageType: 'inline',
  whatsappTemplateId: '',
  discountType: 'percentage',
  discountValue: '',
  expiresInDays: '30',
  execution: 'now',
  scheduledAt: '',
  targetAudience: 'all',
  memberIds: [],
  tagIds: [],
}

export interface CampaignRequestBody {
  name: string
  type: string
  templateEn: string
  templateZhHk: string
  imageUrlEn: string | null
  imageUrlZhHk: string | null
  whatsappTemplateId: string | null
  couponConfig: { discountType: string; discountValue: number; expiresInDays: number } | null
  scheduledAt: string | null
  status: 'active'
  targetAudience: 'all' | 'selected' | 'tag'
  memberIds?: string[]
  tagIds?: string[]
}

export function buildCampaignRequestBody(form: CampaignFormState): CampaignRequestBody {
  const useWaTemplate = form.messageType === 'wa_template'
  const discountValue = Number(form.discountValue)
  // Image attachments are locked to welcome campaigns only (ONBOARD-010).
  const isWelcome = form.type === 'welcome'
  const body: CampaignRequestBody = {
    name: form.name,
    type: form.type,
    templateEn: useWaTemplate ? '' : form.templateEn,
    templateZhHk: useWaTemplate ? '' : form.templateZhHk,
    imageUrlEn: isWelcome ? nullIfBlank(form.imageUrlEn) : null,
    imageUrlZhHk: isWelcome ? nullIfBlank(form.imageUrlZhHk) : null,
    whatsappTemplateId: useWaTemplate ? form.whatsappTemplateId : null,
    couponConfig:
      discountValue > 0
        ? {
            discountType: form.discountType,
            discountValue,
            expiresInDays: Number(form.expiresInDays) || 30,
          }
        : null,
    scheduledAt:
      form.execution === 'schedule' && form.scheduledAt
        ? new Date(form.scheduledAt).toISOString()
        : null,
    status: 'active',
    targetAudience: form.targetAudience,
  }
  if (form.targetAudience === 'selected') body.memberIds = form.memberIds
  if (form.targetAudience === 'tag') body.tagIds = form.tagIds
  return body
}

function nullIfBlank(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export type CampaignValidationKey =
  | 'nameRequired'
  | 'templateRequired'
  | 'templateAtLeastOneRequired'
  | 'selectTag'

export function validateCampaignForm(form: CampaignFormState): CampaignValidationKey | null {
  if (!form.name.trim()) return 'nameRequired'
  if (form.targetAudience === 'tag' && form.tagIds.length === 0) return 'selectTag'
  if (form.messageType === 'wa_template') {
    return form.whatsappTemplateId ? null : 'templateRequired'
  }
  const hasEn = form.templateEn.trim().length > 0
  const hasZh = form.templateZhHk.trim().length > 0
  return hasEn || hasZh ? null : 'templateAtLeastOneRequired'
}
