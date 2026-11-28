import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createWebhookLogger } from '@/infrastructure/logging/logger'
import { findReceiptByJobId } from '@/infrastructure/supabase/repositories/receipt-repository'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { mapFlowForgeResultToReceipt } from '@/infrastructure/flowforge/receipt-mapper'
import { handleParseResult } from '@/application/process-receipt'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'

export async function POST(request: NextRequest) {
  const log = createWebhookLogger(crypto.randomUUID())

  try {
    const body = await request.json()

    const jobId = body.job_id ?? body.extraction_job_id ?? body.data?.job_id ?? body.data?.extraction_job_id ?? body.id
    log('info', 'flowforge.callback', { jobId })

    if (!jobId) {
      log('warn', 'flowforge.missing_job_id', { body })
      return NextResponse.json({ status: 'ok' })
    }

    const receipt = await findReceiptByJobId(jobId)
    if (!receipt) {
      log('warn', 'flowforge.receipt_not_found', { jobId })
      return NextResponse.json({ status: 'ok' })
    }

    if (receipt.status !== 'processing') {
      log('info', 'flowforge.already_handled', { jobId, status: receipt.status })
      return NextResponse.json({ status: 'ok' })
    }

    const parsed = mapFlowForgeResultToReceipt(body)

    const phone = await getMemberPhone(receipt.member_id as string)
    const phoneNumberId = await getRestaurantPhoneNumberId(receipt.restaurant_id as string)

    await handleParseResult({
      receiptId: receipt.id as string,
      memberId: receipt.member_id as string,
      restaurantId: receipt.restaurant_id as string,
      phoneNumberId,
      phone,
      parsed,
      imageUrl: (receipt.image_url as string) ?? undefined,
    })

    log('info', 'flowforge.processed', { jobId, receiptId: receipt.id })
    return NextResponse.json({ status: 'ok' })
  } catch (error) {
    log('error', 'flowforge.error', { error: String(error) })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

async function getMemberPhone(memberId: string): Promise<string> {
  const supabase = createServerSupabaseClient()
  const { data } = await supabase
    .from('members')
    .select('phone')
    .eq('id', memberId)
    .single()

  return data?.phone ?? ''
}
