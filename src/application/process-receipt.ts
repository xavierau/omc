import { submitReceiptExtraction } from '@/infrastructure/flowforge/client'
import { createReceipt, updateReceipt } from '@/infrastructure/supabase/repositories/receipt-repository'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { sendTextMessage } from '@/infrastructure/kapso/client'
import { RECEIPT_CONFIDENCE_THRESHOLD } from '@/lib/constants'
import { awardPoints } from './award-points'
import { validateReceipt } from './validate-receipt'
import { verifyReceiptLayout } from './verify-receipt-layout'
import type { ParsedReceipt } from '@/domain/interfaces/parsed-receipt'

export async function processReceipt(
  restaurantId: string,
  memberId: string,
  phone: string,
  imageUrl: string,
  imageId?: string,
  phoneNumberId?: string
): Promise<void> {
  const receiptId = await createReceipt({
    memberId,
    restaurantId,
    imageUrl,
    status: 'processing',
  })

  try {
    const callbackUrl = buildCallbackUrl(receiptId)
    console.log('[processReceipt] submitting to FlowForge', { receiptId, callbackUrl, imageId, phoneNumberId })
    const jobId = await submitReceiptExtraction({ imageUrl, imageId, phoneNumberId, callbackUrl })
    console.log('[processReceipt] FlowForge job created', { receiptId, jobId })
    await updateReceipt(receiptId, { flowforge_job_id: jobId })
    console.log('[processReceipt] job_id saved to receipt')
  } catch (error) {
    console.error('[processReceipt] submission error:', error)
    await markRejectedAndNotify(receiptId, restaurantId, phone)
  }
}

export async function handleParseResult(params: {
  receiptId: string
  memberId: string
  restaurantId: string
  phoneNumberId: string
  phone: string
  parsed: ParsedReceipt
  imageUrl?: string
}): Promise<void> {
  const { receiptId, memberId, restaurantId, phoneNumberId, phone, parsed, imageUrl } = params

  if (parsed.confidence === 0 || parsed.total === 0) {
    await updateReceipt(receiptId, { status: 'rejected', confidence: parsed.confidence })
    await sendTextMessage(phoneNumberId, phone, "Sorry, I couldn't read that receipt. Could you take a clearer photo?")
    return
  }

  const validation = await validateReceipt({ parsed, restaurantId })
  if (!validation.valid) {
    await updateReceipt(receiptId, {
      status: 'rejected',
      receipt_number: parsed.receiptNumber ?? undefined,
      merchant_name: parsed.merchantName ?? undefined,
      tamper_flags: parsed.tamperAssessment
        ? { isSuspicious: parsed.tamperAssessment.isSuspicious, reasons: parsed.tamperAssessment.reasons }
        : undefined,
    })
    await sendTextMessage(phoneNumberId, phone, validation.rejectionReason!)
    return
  }

  if (parsed.confidence >= RECEIPT_CONFIDENCE_THRESHOLD) {
    await awardPoints({ receiptId, memberId, restaurantId, phoneNumberId, amount: parsed.total, parsed, phone })
    triggerLayoutVerification(receiptId, restaurantId, imageUrl)
    return
  }

  await requestConfirmation(receiptId, parsed, phoneNumberId, phone)
  triggerLayoutVerification(receiptId, restaurantId, imageUrl)
}

async function requestConfirmation(
  receiptId: string,
  parsed: ParsedReceipt,
  phoneNumberId: string,
  phone: string
): Promise<void> {
  await updateReceipt(receiptId, {
    status: 'pending_confirmation',
    pending_amount: parsed.total,
    total_amount: parsed.total,
    items_json: parsed.items,
    confidence: parsed.confidence,
    receipt_number: parsed.receiptNumber ?? undefined,
    merchant_name: parsed.merchantName ?? undefined,
  })
  await sendTextMessage(phoneNumberId, phone,
    `I read your total as $${parsed.total.toFixed(0)}. Is that right?\nReply YES to confirm, or type the correct amount.`)
}

export async function confirmReceipt(
  memberId: string,
  restaurantId: string,
  phone: string,
  receiptId: string,
  confirmedAmount: number
): Promise<void> {
  const phoneNumberId = await getRestaurantPhoneNumberId(restaurantId)
  const receipt = await getReceiptData(receiptId)
  await awardPoints({ receiptId, memberId, restaurantId, phoneNumberId, amount: confirmedAmount, parsed: receipt, phone })
}

function triggerLayoutVerification(
  receiptId: string,
  restaurantId: string,
  imageUrl?: string
): void {
  if (!imageUrl) return
  verifyReceiptLayout({ receiptId, restaurantId, imageUrl }).catch((err) => {
    console.error('[Layout] verification failed:', err)
  })
}

function buildCallbackUrl(receiptId: string): string {
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000'
  return `${appUrl}/api/webhooks/flowforge?receiptId=${receiptId}`
}

async function markRejectedAndNotify(
  receiptId: string,
  restaurantId: string,
  phone: string
): Promise<void> {
  const phoneNumberId = await getRestaurantPhoneNumberId(restaurantId)
  await updateReceipt(receiptId, { status: 'rejected' })
  await sendTextMessage(phoneNumberId, phone, 'Sorry, there was an error processing your receipt. Please try again.')
}

async function getReceiptData(receiptId: string) {
  const { createServerSupabaseClient } = await import('@/infrastructure/supabase/client')
  const supabase = createServerSupabaseClient()
  const { data } = await supabase
    .from('receipts')
    .select('items_json, confidence')
    .eq('id', receiptId)
    .single()
  return { items: data?.items_json, confidence: data?.confidence }
}
