import { couponRequirement, type CouponRequirement } from '@/domain/services/coupon-requirement'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'

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

/**
 * What a send of this form will do with coupons, decided by the same
 * couponRequirement rule the pre-send guard (enforceCouponParams) enforces:
 * 'discount' = couponConfig set · 'marketing_only' = message only, no coupon
 * (#134) · 'blocked' = the message needs a coupon, so Send will be refused ·
 * 'unknown' = a WhatsApp template is chosen but not resolved (loading, fetch
 * failed, or not in the loaded page), so no guess is shown. Expiry is saved
 * only in 'discount' mode.
 */
export type CouponFormMode = 'discount' | 'marketing_only' | 'blocked' | 'unknown'

export interface CouponFormModeResult {
  mode: CouponFormMode
  /** Parsed discountValue when > 0, else null (couponConfig is then null). */
  discount: number | null
}

const MODE_BY_REQUIREMENT: Record<CouponRequirement['kind'], CouponFormMode> = {
  satisfied: 'discount',
  marketing_only: 'marketing_only',
  blocked: 'blocked',
}

export function couponFormMode(
  form: Pick<CampaignFormState, 'messageType' | 'discountValue' | 'templateEn' | 'templateZhHk'>,
  selectedTemplate: WhatsAppTemplate | null
): CouponFormModeResult {
  const discount = parseCouponDiscount(form)
  const usesWaTemplate = form.messageType === 'wa_template'
  if (usesWaTemplate && !selectedTemplate && discount === null) {
    return { mode: 'unknown', discount }
  }
  const requirement = couponRequirement({
    hasCouponConfig: discount !== null,
    template: usesWaTemplate ? selectedTemplate : null,
    inlineTexts: usesWaTemplate ? [] : [form.templateEn, form.templateZhHk],
  })
  return { mode: MODE_BY_REQUIREMENT[requirement.kind], discount }
}

function parseCouponDiscount(form: Pick<CampaignFormState, 'discountValue'>): number | null {
  const value = Number(form.discountValue)
  return value > 0 ? value : null
}

export function buildCampaignRequestBody(form: CampaignFormState): CampaignRequestBody {
  const useWaTemplate = form.messageType === 'wa_template'
  const discountValue = parseCouponDiscount(form)
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
    couponConfig: discountValue !== null
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
