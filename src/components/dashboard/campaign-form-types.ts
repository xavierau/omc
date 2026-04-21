export interface CampaignFormState {
  name: string
  type: string
  templateEn: string
  templateZhHk: string
  messageType: 'inline' | 'wa_template'
  whatsappTemplateId: string
  discountType: string
  discountValue: string
  expiresInDays: string
  execution: 'now' | 'schedule'
  scheduledAt: string
  targetAudience: 'all' | 'selected'
  memberIds: string[]
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
  messageType: 'inline',
  whatsappTemplateId: '',
  discountType: 'percentage',
  discountValue: '',
  expiresInDays: '30',
  execution: 'now',
  scheduledAt: '',
  targetAudience: 'all',
  memberIds: [],
}

export interface CampaignRequestBody {
  name: string
  type: string
  templateEn: string
  templateZhHk: string
  whatsappTemplateId: string | null
  couponConfig: { discountType: string; discountValue: number; expiresInDays: number } | null
  scheduledAt: string | null
  status: 'active'
  targetAudience: 'all' | 'selected'
  memberIds?: string[]
}

export function buildCampaignRequestBody(form: CampaignFormState): CampaignRequestBody {
  const useWaTemplate = form.messageType === 'wa_template'
  const discountValue = Number(form.discountValue)
  const body: CampaignRequestBody = {
    name: form.name,
    type: form.type,
    templateEn: useWaTemplate ? '' : form.templateEn,
    templateZhHk: useWaTemplate ? '' : form.templateZhHk,
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
  return body
}

export type CampaignValidationKey =
  | 'nameRequired'
  | 'templateRequired'
  | 'templateAtLeastOneRequired'

export function validateCampaignForm(form: CampaignFormState): CampaignValidationKey | null {
  if (!form.name.trim()) return 'nameRequired'
  if (form.messageType === 'wa_template') {
    return form.whatsappTemplateId ? null : 'templateRequired'
  }
  const hasEn = form.templateEn.trim().length > 0
  const hasZh = form.templateZhHk.trim().length > 0
  return hasEn || hasZh ? null : 'templateAtLeastOneRequired'
}
