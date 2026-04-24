import { Campaign, CouponConfig } from '@/domain/entities/campaign'

export interface CreateCampaignParams {
  restaurantId: string
  name: string
  type: Campaign['type']
  /**
   * Explicit value for the legacy `template` column. Callers (e.g. the POST
   * route) compute this from the bilingual fields + restaurant default
   * language and pass it in so sparse bilingual creates don't populate the
   * legacy column with the wrong language's content.
   */
  legacyTemplate: string
  templateEn?: string | null
  templateZhHk?: string | null
  imageUrlEn?: string | null
  imageUrlZhHk?: string | null
  couponConfig?: CouponConfig | null
  schedule?: Record<string, unknown> | null
  scheduledAt?: string | null
  whatsappTemplateId?: string | null
  targetAudience?: Campaign['targetAudience']
  status?: Campaign['status']
}

export interface UpdateCampaignParams {
  name?: string
  type?: Campaign['type']
  template?: string
  templateEn?: string | null
  templateZhHk?: string | null
  imageUrlEn?: string | null
  imageUrlZhHk?: string | null
  /**
   * Explicit value for the legacy `template` column. Callers (e.g. the PATCH
   * route) compute this from the current row + patch + restaurant default
   * language and pass it in so sparse bilingual patches don't corrupt the
   * legacy column. Leave `undefined` to skip dual-write.
   */
  legacyTemplate?: string
  couponConfig?: CouponConfig | null
  schedule?: Record<string, unknown> | null
  scheduledAt?: string | null
  whatsappTemplateId?: string | null
  targetAudience?: Campaign['targetAudience']
  status?: Campaign['status']
}

export function mapRowToCampaign(row: Record<string, unknown>): Campaign {
  return {
    id: row.id as string,
    restaurantId: row.restaurant_id as string,
    name: (row.name as string) ?? null,
    type: row.type as Campaign['type'],
    template: (row.template as string) ?? '',
    templateEn: (row.template_en as string | null) ?? null,
    templateZhHk: (row.template_zh_hk as string | null) ?? null,
    imageUrlEn: (row.image_url_en as string | null) ?? null,
    imageUrlZhHk: (row.image_url_zh_hk as string | null) ?? null,
    couponConfig: (row.coupon_config as CouponConfig) ?? null,
    schedule: (row.schedule as Record<string, unknown>) ?? null,
    scheduledAt: (row.scheduled_at as string) ?? null,
    status: row.status as Campaign['status'],
    isChargeable: (row.is_chargeable as boolean | undefined) ?? true,
    chargeableSentCount: Number(row.chargeable_sent_count ?? 0),
    nonChargeableSentCount: Number(row.non_chargeable_sent_count ?? 0),
    redeemedCount: Number(row.redeemed_count ?? 0),
    whatsappTemplateId: (row.whatsapp_template_id as string) ?? null,
    targetAudience:
      (row.target_audience as Campaign['targetAudience']) ?? 'all',
    createdAt: row.created_at as string,
  }
}

/**
 * Translate the application-layer UPDATE patch into a row patch. The mapper
 * is a dumb field-translator: it writes the legacy `template` column only
 * when the caller passes an explicit `template` or `legacyTemplate`. Legacy
 * dual-write is the caller's responsibility (see PATCH route), which owns
 * the before-row + restaurant.default_language context needed to pick the
 * right language.
 */
export function buildCampaignUpdateRow(
  changes: UpdateCampaignParams
): Record<string, unknown> {
  const update: Record<string, unknown> = {}

  if (changes.name !== undefined) update.name = changes.name
  if (changes.type !== undefined) update.type = changes.type
  if (changes.templateEn !== undefined) update.template_en = changes.templateEn
  if (changes.templateZhHk !== undefined) update.template_zh_hk = changes.templateZhHk
  if (changes.imageUrlEn !== undefined) update.image_url_en = changes.imageUrlEn
  if (changes.imageUrlZhHk !== undefined) update.image_url_zh_hk = changes.imageUrlZhHk
  if (changes.couponConfig !== undefined) update.coupon_config = changes.couponConfig
  if (changes.schedule !== undefined) update.schedule = changes.schedule
  if (changes.scheduledAt !== undefined) update.scheduled_at = changes.scheduledAt
  if (changes.whatsappTemplateId !== undefined) update.whatsapp_template_id = changes.whatsappTemplateId
  if (changes.targetAudience !== undefined) update.target_audience = changes.targetAudience
  if (changes.status !== undefined) update.status = changes.status

  if (changes.template !== undefined) {
    update.template = changes.template
  } else if (changes.legacyTemplate !== undefined) {
    update.template = changes.legacyTemplate
  }
  return update
}

// PostgREST doesn't always populate `constraint`, so fall back to scanning
// the error message/details for the quoted index name.
export function extractConstraintName(
  error: { constraint?: string; message?: string; details?: string }
): string | null {
  if (error.constraint) return error.constraint
  const haystack = `${error.message ?? ''} ${error.details ?? ''}`
  const match = haystack.match(/"([a-z0-9_]+)"/i)
  return match ? match[1] : null
}
