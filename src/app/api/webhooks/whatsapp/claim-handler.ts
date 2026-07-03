import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import { getCampaignById } from '@/infrastructure/supabase/repositories/campaign-repository'
import { sendTextMessage, sendImageMessage } from '@/infrastructure/whatsapp/messaging'
import { uploadCouponQr } from '@/infrastructure/supabase/storage'
import { recordOutboundSend } from '@/application/record-outbound-send'
import { claimCampaignCoupon } from '@/application/claim-campaign-coupon'
import { maskPhone } from '@/infrastructure/logging/logger'
import { resolveLanguageForMember } from './resolve-language'
import { getSystemReply } from './system-replies'
import type { Campaign } from '@/domain/entities/campaign'
import type { Language } from '@/domain/value-objects/language'

type LogFn = (level: 'info' | 'warn' | 'error', event: string, data: unknown) => void

interface HandleClaimParams {
  phoneNumberId: string
  phone: string
  campaignId: string
  restaurantId: string
  log: LogFn
}

// The claim window is open while a broadcast is live (active/sending) or has
// finished (completed); draft/paused campaigns refuse the tap.
const CLAIMABLE_STATUSES: ReadonlyArray<Campaign['status']> = [
  'active', 'sending', 'completed',
]

export function isCampaignClaimable(status: Campaign['status']): boolean {
  return CLAIMABLE_STATUSES.includes(status)
}

/**
 * CAMP-001: handle a `CLAIM_<campaignId>` button tap — re-check membership and
 * tenant ownership, mint the coupon idempotently, then send the QR. Never
 * throws; on any unexpected failure it falls back to an English apology
 * (mirrors handleRewardRedeem).
 */
export async function handleClaim(params: HandleClaimParams) {
  try {
    return await runClaim(params)
  } catch (error) {
    console.error('Claim error:', error)
    return sendTextMessage(
      params.phoneNumberId,
      params.phone,
      'Sorry, something went wrong. Please try again later.'
    )
  }
}

async function runClaim(params: HandleClaimParams) {
  const { restaurantId, phone, campaignId, log } = params
  const member = await findMemberByPhone(restaurantId, phone)
  const lang = await resolveLanguageForMember(member, restaurantId)
  if (!member) return reply(params, getSystemReply('nonMember', lang))

  const campaign = await getCampaignById(campaignId)
  if (!campaign || campaign.restaurantId !== restaurantId) {
    log('warn', 'claim.tenant_mismatch', { campaignId, phone: maskPhone(phone) })
    return reply(params, getSystemReply('campaignUnavailable', lang))
  }
  if (!isCampaignClaimable(campaign.status)) {
    return reply(params, getSystemReply('campaignUnavailable', lang))
  }

  const { coupon } = await claimCampaignCoupon({ campaign, member })
  return sendClaimQr({ params, code: coupon.code, memberId: member.id, lang })
}

function reply(params: HandleClaimParams, text: string) {
  return sendTextMessage(params.phoneNumberId, params.phone, text)
}

interface SendClaimQrArgs {
  params: HandleClaimParams
  code: string
  memberId: string
  lang: Language
}

function sendClaimQr({ params, code, memberId, lang }: SendClaimQrArgs) {
  const { phoneNumberId, phone, campaignId, restaurantId } = params
  const caption = getSystemReply('claimReady', lang, { code })
  return sendQrImage({ phoneNumberId, phone, restaurantId, memberId, campaignId, code, caption })
}

interface SendQrImageArgs {
  phoneNumberId: string
  phone: string
  restaurantId: string
  memberId: string
  campaignId: string
  code: string
  caption: string
}

async function sendQrImage(a: SendQrImageArgs) {
  const qrUrl = await uploadCouponQr(a.code)
  return recordOutboundSend({
    restaurantId: a.restaurantId,
    memberId: a.memberId,
    campaignId: a.campaignId,
    phoneE164: a.phone,
    category: 'service',
    messageType: 'image',
    contentPreview: `Your code: ${a.code}`,
    trackingEnabled: process.env.WAQ_TRACK_MESSAGES === '1',
    send: () => sendImageMessage(a.phoneNumberId, a.phone, qrUrl, a.caption),
  })
}
