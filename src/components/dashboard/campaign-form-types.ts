import { couponRequirement, type CouponRequirement } from '@/domain/services/coupon-requirement'
import { isQrOnlyCouponCampaign } from '@/domain/services/campaign-qr-only'
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
 * Where the selected WhatsApp template's full entity comes from: the loaded
 * approved list first, else GET /api/dashboard/wa-templates/[id] (a saved
 * template past the list's first page, or no longer approved). 'unselected' =
 * no template chosen yet.
 */
export type TemplateLookup =
  | { status: 'resolved'; template: WhatsAppTemplate }
  | { status: 'loading' | 'error' | 'unselected' }

export interface TemplateListSource {
  templates: WhatsAppTemplate[]
  isLoading: boolean
  error: string | null
}

export interface SingleTemplateSource {
  template: WhatsAppTemplate | null
  isLoading: boolean
  error: string | null
}

type LookupForm = Pick<CampaignFormState, 'messageType' | 'whatsappTemplateId'>

function selectedTemplateId(form: LookupForm): string | null {
  return form.messageType === 'wa_template' && form.whatsappTemplateId ? form.whatsappTemplateId : null
}

/** The id to fetch individually, or null when the list has it (or has not loaded yet). */
export function singleTemplateIdToFetch(form: LookupForm, list: TemplateListSource): string | null {
  const id = selectedTemplateId(form)
  if (!id || list.isLoading) return null
  return list.templates.some((tpl) => tpl.id === id) ? null : id
}

export function templateLookup(
  form: LookupForm,
  list: TemplateListSource,
  single: SingleTemplateSource
): TemplateLookup {
  const id = selectedTemplateId(form)
  if (!id) return { status: 'unselected' }
  const listed = list.templates.find((tpl) => tpl.id === id)
  if (listed) return { status: 'resolved', template: listed }
  if (list.isLoading || single.isLoading) return { status: 'loading' }
  if (single.template?.id === id) return { status: 'resolved', template: single.template }
  return { status: single.error || list.error ? 'error' : 'loading' }
}

/** Picker options: the list, plus the resolved selection when the list page lacks it. */
export function pickerTemplates(templates: WhatsAppTemplate[], lookup: TemplateLookup): WhatsAppTemplate[] {
  if (lookup.status !== 'resolved') return templates
  const { template } = lookup
  return templates.some((tpl) => tpl.id === template.id) ? templates : [...templates, template]
}

/**
 * What a send of this form will do with coupons, decided by the same
 * couponRequirement rule the pre-send guard (enforceCouponParams) enforces:
 * 'discount' = couponConfig set · 'marketing_only' = message only, no coupon
 * (#134) · 'blocked' = the message needs a coupon, so Send will be refused ·
 * 'welcome_requires_discount' = a welcome campaign: the welcome send path
 * always mints a coupon, so no discount means every welcome send fails (checked
 * first; Save is blocked by validateCampaignForm) · 'unknown' = a WhatsApp
 * template is selected-or-pending but not resolved; `pending` says why.
 * Expiry is saved only in 'discount' mode.
 */
export type CouponFormMode = 'discount' | 'marketing_only' | 'blocked' | 'welcome_requires_discount' | 'unknown'

export type CouponFormModeResult =
  | { mode: Exclude<CouponFormMode, 'unknown'> }
  | { mode: 'unknown'; pending: Exclude<TemplateLookup['status'], 'resolved'> }

const MODE_BY_REQUIREMENT: Record<CouponRequirement['kind'], Exclude<CouponFormMode, 'unknown'>> = {
  satisfied: 'discount',
  marketing_only: 'marketing_only',
  blocked: 'blocked',
}

type CouponModeForm = Pick<
  CampaignFormState,
  'type' | 'messageType' | 'discountValue' | 'templateEn' | 'templateZhHk'
>

export function couponFormMode(form: CouponModeForm, lookup: TemplateLookup): CouponFormModeResult {
  const hasDiscount = parseCouponDiscount(form) !== null
  if (form.type === 'welcome' && !hasDiscount) return { mode: 'welcome_requires_discount' }
  const usesWaTemplate = form.messageType === 'wa_template'
  if (usesWaTemplate && !hasDiscount && lookup.status !== 'resolved') {
    return { mode: 'unknown', pending: lookup.status }
  }
  const requirement = couponRequirement({
    hasCouponConfig: hasDiscount,
    template: usesWaTemplate && lookup.status === 'resolved' ? lookup.template : null,
    inlineTexts: usesWaTemplate ? [] : [form.templateEn, form.templateZhHk],
  })
  return { mode: MODE_BY_REQUIREMENT[requirement.kind] }
}

/** CAMP-014: warn (never block) when the selected template leaves the code only in the QR. */
export function couponFormQrOnly(
  form: Pick<CampaignFormState, 'type' | 'messageType' | 'discountValue'>,
  lookup: TemplateLookup
): boolean {
  return isQrOnlyCouponCampaign({
    type: form.type,
    hasCouponConfig: parseCouponDiscount(form) !== null,
    template: form.messageType === 'wa_template' && lookup.status === 'resolved' ? lookup.template : null,
  })
}

/** The one "has a discount" rule: the discount value when > 0, else null (couponConfig is then null). */
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
  | 'welcomeDiscountRequired'

export function validateCampaignForm(form: CampaignFormState): CampaignValidationKey | null {
  if (!form.name.trim()) return 'nameRequired'
  if (form.targetAudience === 'tag' && form.tagIds.length === 0) return 'selectTag'
  // The welcome send path always mints a coupon (process-welcome-send-job), so a
  // welcome campaign without a discount would fail every send.
  if (form.type === 'welcome' && parseCouponDiscount(form) === null) return 'welcomeDiscountRequired'
  if (form.messageType === 'wa_template') {
    return form.whatsappTemplateId ? null : 'templateRequired'
  }
  const hasEn = form.templateEn.trim().length > 0
  const hasZh = form.templateZhHk.trim().length > 0
  return hasEn || hasZh ? null : 'templateAtLeastOneRequired'
}
