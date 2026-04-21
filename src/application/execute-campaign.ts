import { getCampaignById, incrementCampaignSent, updateCampaign, transitionCampaignStatus } from '@/infrastructure/supabase/repositories/campaign-repository'
import { createCoupon } from '@/infrastructure/supabase/repositories/coupon-repository'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { emitEvent } from '@/application/emit-event'
import { sendTextMessage, sendImageMessage } from '@/infrastructure/whatsapp/messaging'
import { uploadCouponQr } from '@/infrastructure/supabase/storage'
import { generateCouponCode } from '@/domain/value-objects/coupon-code'
import { renderTemplate } from '@/domain/services/template-renderer'
import { resolveTargetMembers } from './resolve-campaign-members'
import { checkCampaignGuardrails } from './check-campaign-guardrails'
import { CampaignGuardrailError } from './campaign-guardrail-error'
import { sendWhatsAppTemplateMessage } from './send-template-message'
import { findTemplateById } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { isTemplateSendable, WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import { Campaign, CouponConfig } from '@/domain/entities/campaign'
import { Member } from '@/domain/entities/member'

const BATCH_SIZE = 20
const BATCH_DELAY_MS = 1000

export async function executeCampaign(
  campaignId: string,
  restaurantId: string
): Promise<void> {
  const campaign = await getCampaignById(campaignId)
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`)
  if (campaign.type === 'welcome') {
    throw new Error('Welcome campaigns are triggered on member join')
  }

  const members = await resolveTargetMembers(campaign, restaurantId)
  const activeMembers = members.filter((m) => m.status !== 'unsubscribed')
  await enforceGuardrails(restaurantId, activeMembers.length)

  const claimed = await transitionCampaignStatus(campaignId, 'active', 'sending')
  if (!claimed) throw new Error(`Campaign ${campaignId} not active or already processing`)

  try {
    const phoneNumberId = await getRestaurantPhoneNumberId(restaurantId)
    const template = await resolveWhatsAppTemplate(campaign)
    await sendInBatches(activeMembers, campaign, phoneNumberId, template)
    await updateCampaign(campaignId, { status: 'completed' })
  } catch (err) {
    await updateCampaign(campaignId, { status: 'active' })
    throw err
  }
}

async function sendInBatches(
  members: Member[],
  campaign: Campaign,
  phoneNumberId: string,
  template: WhatsAppTemplate | null
): Promise<void> {
  let failedCount = 0
  for (let i = 0; i < members.length; i += BATCH_SIZE) {
    const batch = members.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map((m) => sendToMember(m, campaign, phoneNumberId, template))
    )
    for (const r of results) {
      if (r.status === 'rejected') {
        failedCount++
        console.error('[Campaign] Member send failed:', r.reason)
      }
    }
    if (i + BATCH_SIZE < members.length) await delay(BATCH_DELAY_MS)
  }
  if (failedCount > 0) {
    console.warn(`[Campaign] ${failedCount}/${members.length} sends failed`)
  }
}

async function sendToMember(
  member: Member,
  campaign: Campaign,
  phoneNumberId: string,
  template: WhatsAppTemplate | null
): Promise<void> {
  const code = generateCouponCode()
  await createCampaignCoupon(campaign, member, code)

  if (template) {
    await sendViaTemplate(phoneNumberId, member, campaign, template, code)
  } else {
    const text = renderCampaignTemplate(campaign, member, code)
    await sendTextMessage(phoneNumberId, member.phone, text)
  }
  await sendCouponQr(phoneNumberId, member.phone, code)
  await incrementCampaignSent(campaign.id, campaign.isChargeable)
  await emitEvent({
    restaurantId: campaign.restaurantId,
    memberId: member.id,
    type: 'campaign',
    dataJson: { campaignId: campaign.id, couponCode: code },
  })
}

async function resolveWhatsAppTemplate(
  campaign: Campaign
): Promise<WhatsAppTemplate | null> {
  if (!campaign.whatsappTemplateId) return null
  const template = await findTemplateById(campaign.whatsappTemplateId)
  if (!template) {
    throw new Error(`WhatsApp template ${campaign.whatsappTemplateId} not found`)
  }
  if (!isTemplateSendable(template)) {
    throw new Error(`WhatsApp template ${template.name} is not approved`)
  }
  return template
}

async function sendViaTemplate(
  phoneNumberId: string,
  member: Member,
  campaign: Campaign,
  template: WhatsAppTemplate,
  code: string
): Promise<void> {
  const discount = formatDiscount(campaign.couponConfig)
  await sendWhatsAppTemplateMessage({
    phoneNumberId,
    to: member.phone,
    template,
    paramValues: {
      customer_name: member.name ?? 'there',
      code,
      discount,
    },
    couponCode: code,
  })
}

async function createCampaignCoupon(
  campaign: Campaign,
  member: Member,
  code: string
): Promise<void> {
  const config = campaign.couponConfig
  const expiresAt = config
    ? new Date(Date.now() + config.expiresInDays * 86400000).toISOString()
    : null

  const discount = formatDiscount(config)
  const description = renderTemplate(campaign.template, {
    name: member.name ?? '',
    code,
    discount,
  })
  await createCoupon({
    restaurantId: campaign.restaurantId,
    type: 'promo',
    code,
    memberId: member.id,
    campaignId: campaign.id,
    expiresAt,
    discountType: config?.discountType ?? null,
    discountValue: config?.discountValue ?? null,
    maxUses: 1,
    isChargeable: campaign.isChargeable,
    title: campaign.name ?? null,
    description,
  })
}

function renderCampaignTemplate(
  campaign: Campaign,
  member: Member,
  code: string
): string {
  const discount = formatDiscount(campaign.couponConfig)
  return renderTemplate(campaign.template, {
    name: member.name ?? 'there',
    code,
    discount,
  })
}

function formatDiscount(config: CouponConfig | null): string {
  if (!config) return ''
  if (config.discountType === 'percentage') return `${config.discountValue}%`
  return `HK$${config.discountValue}`
}

async function sendCouponQr(
  phoneNumberId: string,
  phone: string,
  code: string
): Promise<void> {
  try {
    const qrUrl = await uploadCouponQr(code)
    await sendImageMessage(phoneNumberId, phone, qrUrl, `Your code: ${code}`)
  } catch (err) {
    console.warn('[Campaign] QR send failed:', (err as Error).message)
  }
}

async function enforceGuardrails(
  restaurantId: string,
  memberCount: number
): Promise<void> {
  const result = await checkCampaignGuardrails(restaurantId, memberCount)
  if (!result.allowed) {
    throw new CampaignGuardrailError(result.violations)
  }
  if (result.warnings.length > 0) {
    console.warn('[Campaign] Guardrail warnings:', result.warnings)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export { CampaignGuardrailError } from './campaign-guardrail-error'
