import { NextRequest, NextResponse } from 'next/server'
import { confirmReceipt } from '@/application/process-receipt'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    return await handleConfirmation(body)
  } catch (error) {
    console.error('Receipt process error:', error)
    return NextResponse.json({ error: 'Failed to process receipt' }, { status: 500 })
  }
}

async function handleConfirmation(body: Record<string, unknown>) {
  const { memberId, restaurantId, phone, receiptId, confirmedAmount } = body

  if (!memberId || !restaurantId || !phone || !receiptId || confirmedAmount === undefined) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (typeof confirmedAmount !== 'number' || !isFinite(confirmedAmount) || confirmedAmount <= 0) {
    return NextResponse.json({ error: 'confirmedAmount must be a positive number' }, { status: 400 })
  }

  await confirmReceipt(
    memberId as string,
    restaurantId as string,
    phone as string,
    receiptId as string,
    confirmedAmount as number
  )

  return NextResponse.json({ status: 'ok' })
}
