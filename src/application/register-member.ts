import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { getOnboardingSettings } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import { PhoneNumber } from '@/domain/value-objects/phone-number'
import { renderTemplate } from '@/domain/services/template-renderer'
import {
  defaultReturningText,
  minimalWelcomeText,
} from './onboarding-defaults'
import { onboardNewMember } from './onboard-new-member'

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
    await sendReturning(restaurantId, phoneNumberId, phone.value, existing.points_balance, name)
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

async function sendReturning(
  restaurantId: string,
  phoneNumberId: string,
  phone: string,
  points: number,
  name?: string
): Promise<void> {
  const greeting = name ? `Welcome back, ${name}!` : 'Welcome back!'
  const settings = await getOnboardingSettings(restaurantId).catch((err) => {
    console.warn('[onboarding] returning-member settings load failed:', err)
    return null
  })
  const tpl = settings?.returningMemberTemplate?.trim()
  const text = tpl
    ? renderTemplate(tpl, { greeting, points, name: name ?? '' })
    : defaultReturningText(greeting, points)
  await sendTextMessage(phoneNumberId, phone, text)
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

  let couponCode: string | undefined
  try {
    couponCode = await onboardNewMember({
      restaurantId,
      memberId: newMember.id,
      phoneNumberId,
      phone: phone.value,
      contactName,
    })
  } catch (err) {
    console.warn('[register] Post-insert step failed:', (err as Error).message)
    if (!couponCode) {
      await sendTextMessage(phoneNumberId, phone.value, minimalWelcomeText(contactName)).catch(() => {})
    }
  }

  return { isNew: true, memberId: newMember.id, pointsBalance: 0, couponCode }
}
