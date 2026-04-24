import { MAX_TEMPLATE_LENGTH } from '@/domain/onboarding/onboarding-settings'

const ALLOWED_TYPES = ['welcome', 'winback', 'birthday', 'promo'] as const
const ALLOWED_STATUSES = ['draft', 'active'] as const
const DISCOUNT_TYPES = ['percentage', 'fixed_amount'] as const

export class CampaignBodyError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message)
  }
}

export interface ParsedCampaignBody {
  name: string
  type: (typeof ALLOWED_TYPES)[number]
  template: string
  templateEn: string | null
  templateZhHk: string | null
  imageUrlEn: string | null
  imageUrlZhHk: string | null
  whatsappTemplateId: string | null
  couponConfig: Record<string, unknown> | null
  scheduledAt: string | null
  schedule: Record<string, unknown> | null
  status: (typeof ALLOWED_STATUSES)[number]
  targetAudience: 'all' | 'selected'
  memberIds: string[]
}

export function parseCreateBody(
  body: Record<string, unknown>,
  restaurantId: string
): ParsedCampaignBody {
  if (!body.name || typeof body.name !== 'string') {
    throw new CampaignBodyError(400, 'name is required')
  }
  if (!ALLOWED_TYPES.includes(body.type as (typeof ALLOWED_TYPES)[number])) {
    throw new CampaignBodyError(400, `type must be one of: ${ALLOWED_TYPES.join(', ')}`)
  }
  const { template, templateEn, templateZhHk } = extractTemplates(body)
  const hasWaTemplate =
    typeof body.whatsappTemplateId === 'string' && body.whatsappTemplateId.length > 0
  const hasInline =
    (templateEn && templateEn.length > 0) ||
    (templateZhHk && templateZhHk.length > 0) ||
    template.length > 0
  if (!hasWaTemplate && !hasInline) {
    throw new CampaignBodyError(
      400,
      'templateEn, templateZhHk, or whatsappTemplateId is required'
    )
  }
  validateCouponConfig(body.couponConfig)
  validateStatus(body.status)
  const targetAudience: 'all' | 'selected' =
    body.targetAudience === 'selected' ? 'selected' : 'all'
  const memberIds = validateMemberIds(body.memberIds, targetAudience)
  const type = body.type as (typeof ALLOWED_TYPES)[number]
  // Welcome-only scope guard: non-welcome campaigns never persist images,
  // even when a direct API caller tries to include them.
  const allowImages = type === 'welcome'
  return {
    name: body.name,
    type,
    template,
    templateEn,
    templateZhHk,
    imageUrlEn: allowImages ? parseImageUrl(body.imageUrlEn, restaurantId) : null,
    imageUrlZhHk: allowImages ? parseImageUrl(body.imageUrlZhHk, restaurantId) : null,
    whatsappTemplateId: hasWaTemplate ? (body.whatsappTemplateId as string) : null,
    couponConfig: (body.couponConfig as Record<string, unknown>) ?? null,
    scheduledAt: (body.scheduledAt as string) ?? null,
    schedule: (body.schedule as Record<string, unknown>) ?? null,
    status: (body.status as (typeof ALLOWED_STATUSES)[number]) ?? 'draft',
    targetAudience,
    memberIds,
  }
}

function extractTemplates(body: Record<string, unknown>) {
  const legacy = parseTemplateField(body.template, 'template')
  const en = parseTemplateField(body.templateEn, 'templateEn')
  const zhHk = parseTemplateField(body.templateZhHk, 'templateZhHk')
  // Back-compat: if only legacy `template` sent, copy to `templateZhHk`.
  const finalZhHk =
    zhHk === undefined && legacy !== undefined && legacy !== null && legacy !== ''
      ? legacy
      : zhHk
  return {
    template: legacy ?? '',
    templateEn: en ?? null,
    templateZhHk: finalZhHk ?? null,
  }
}

function parseTemplateField(
  value: unknown,
  field: string
): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  if (value.length > MAX_TEMPLATE_LENGTH) {
    throw new CampaignBodyError(
      400,
      `${field} must be ${MAX_TEMPLATE_LENGTH} characters or fewer`
    )
  }
  return value
}

/**
 * Validate and normalise a campaign image URL. Callers must pass the
 * authenticated restaurantId so cross-tenant URLs can be rejected.
 *
 * Accepted shape: `https://{host}/storage/v1/object/public/campaign-images/{restaurantId}/...`
 *
 * Rejects: non-https schemes (blocks `javascript:`, `http://`, `file:`…),
 * URLs outside the `campaign-images` bucket, and URLs pointing at a
 * different tenant's prefix.
 */
const CAMPAIGN_IMAGE_PATH_RE =
  /\/storage\/v1\/object\/public\/campaign-images\/([^/]+)\//

export function parseImageUrl(v: unknown, restaurantId: string): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  if (trimmed === '') return null
  if (!trimmed.startsWith('https://')) {
    throw new CampaignBodyError(
      400,
      'image URL must use https:// scheme'
    )
  }
  const match = trimmed.match(CAMPAIGN_IMAGE_PATH_RE)
  if (!match) {
    throw new CampaignBodyError(
      400,
      'image URL must point at /storage/v1/object/public/campaign-images/'
    )
  }
  if (match[1] !== restaurantId) {
    throw new CampaignBodyError(
      400,
      'image URL tenant prefix does not match the authenticated tenant'
    )
  }
  return trimmed
}

function validateCouponConfig(config: unknown): void {
  if (config === undefined || config === null) return
  if (typeof config !== 'object') {
    throw new CampaignBodyError(400, 'couponConfig must be an object')
  }
  const c = config as Record<string, unknown>
  if (!DISCOUNT_TYPES.includes(c.discountType as (typeof DISCOUNT_TYPES)[number])) {
    throw new CampaignBodyError(400, 'discountType must be percentage or fixed_amount')
  }
  if (typeof c.discountValue !== 'number' || c.discountValue <= 0) {
    throw new CampaignBodyError(400, 'discountValue must be a positive number')
  }
  const exp = c.expiresInDays
  if (typeof exp !== 'number' || exp < 1 || !Number.isInteger(exp)) {
    throw new CampaignBodyError(400, 'expiresInDays must be a positive integer')
  }
}

function validateStatus(status: unknown): void {
  if (status === undefined || status === null) return
  if (!ALLOWED_STATUSES.includes(status as (typeof ALLOWED_STATUSES)[number])) {
    throw new CampaignBodyError(400, `status must be one of: ${ALLOWED_STATUSES.join(', ')}`)
  }
}

function validateMemberIds(
  value: unknown,
  targetAudience: 'all' | 'selected'
): string[] {
  if (targetAudience !== 'selected') return []
  const ok =
    Array.isArray(value) && value.length > 0 && value.every((id) => typeof id === 'string')
  if (!ok) {
    throw new CampaignBodyError(
      400,
      'memberIds must be a non-empty array of strings when targeting selected members'
    )
  }
  return value as string[]
}
