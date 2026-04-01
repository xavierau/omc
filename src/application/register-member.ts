import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { createWelcomeCoupon } from '@/infrastructure/supabase/repositories/coupon-repository'
import { createEvent } from '@/infrastructure/supabase/repositories/event-repository'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { incrementCampaignSent } from '@/infrastructure/supabase/repositories/campaign-repository'
import { sendTextMessage, sendImageMessage } from '@/infrastructure/kapso/client'
import { uploadCouponQr } from '@/infrastructure/supabase/storage'
import { PhoneNumber } from '@/domain/value-objects/phone-number'

interface RegisterResult {
  isNew: boolean
  memberId: string
  pointsBalance: number
  couponCode?: string
}

export async function registerMember(
  restaurantId: string,
  rawPhone: string,
  contactName?: string
): Promise<RegisterResult> {
  const phone = PhoneNumber.create(rawPhone)
  const supabase = createServerSupabaseClient()
  const phoneNumberId = await getRestaurantPhoneNumberId(restaurantId)

  const existing = await findExistingMember(supabase, restaurantId, phone.value)
  if (existing) {
    const name = existing.name ?? contactName
    await sendWelcomeBack(phoneNumberId, phone.value, existing.points_balance, name)
    return { isNew: false, memberId: existing.id, pointsBalance: existing.points_balance }
  }

  return createNewMember(supabase, restaurantId, phoneNumberId, phone, contactName)
}

async function findExistingMember(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  restaurantId: string,
  phone: string
) {
  const { data } = await supabase
    .from('members')
    .select('id, points_balance, name')
    .eq('restaurant_id', restaurantId)
    .eq('phone', phone)
    .single()

  return data
}

async function sendWelcomeBack(
  phoneNumberId: string,
  phone: string,
  points: number,
  name?: string
) {
  const greeting = name ? `Welcome back, ${name}!` : 'Welcome back!'
  await sendTextMessage(
    phoneNumberId,
    phone,
    `${greeting} You're already a member. Your balance: ${points} points. Reply POINTS to check balance or send a receipt photo to earn more.`
  )
}

async function createNewMember(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  restaurantId: string,
  phoneNumberId: string,
  phone: PhoneNumber,
  contactName?: string
): Promise<RegisterResult> {
  const { data: newMember, error } = await supabase
    .from('members')
    .insert({
      restaurant_id: restaurantId,
      phone: phone.value,
      status: 'active',
      name: contactName ?? null,
    })
    .select('id')
    .single()

  if (error || !newMember) throw new Error(`registerMember: ${error?.message}`)

  const coupon = await createWelcomeCoupon(restaurantId, newMember.id)
  const { template, campaignId } = await getWelcomeCampaignInfo(supabase, restaurantId)

  if (campaignId) {
    await incrementCampaignSent(campaignId)
  }

  await createEvent({
    restaurantId,
    memberId: newMember.id,
    type: 'join',
    dataJson: { source: 'whatsapp', coupon_code: coupon.code },
  })

  await sendTextMessage(
    phoneNumberId,
    phone.value,
    `Welcome to our loyalty program${contactName ? `, ${contactName}` : ''}!\n\nYou've received a welcome gift!\nUse code: ${coupon.code}\n\nReply POINTS to check balance, or send a receipt photo to earn points.`
  )

  await sendCouponQrImage(phoneNumberId, phone.value, coupon.code, template)

  return { isNew: true, memberId: newMember.id, pointsBalance: 0, couponCode: coupon.code }
}

interface WelcomeCampaignInfo {
  template: string | null
  campaignId: string | null
}

async function getWelcomeCampaignInfo(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  restaurantId: string
): Promise<WelcomeCampaignInfo> {
  const { data } = await supabase
    .from('campaigns')
    .select('id, template')
    .eq('restaurant_id', restaurantId)
    .eq('type', 'welcome')
    .eq('status', 'active')
    .single()

  return {
    template: data?.template ?? null,
    campaignId: data?.id ?? null,
  }
}

async function sendCouponQrImage(
  phoneNumberId: string,
  phone: string,
  couponCode: string,
  campaignTemplate: string | null
): Promise<void> {
  try {
    const qrUrl = await uploadCouponQr(couponCode)
    const caption = campaignTemplate
      ? `${campaignTemplate}\n\nYour code: ${couponCode}\nShow this QR to our staff to redeem.`
      : `Your Welcome Coupon: ${couponCode}\n\nShow this QR code to our staff to redeem.`
    await sendImageMessage(phoneNumberId, phone, qrUrl, caption)
  } catch (err) {
    console.warn('[QR] Failed to send coupon QR:', (err as Error).message)
  }
}
