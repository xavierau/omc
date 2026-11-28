/**
 * BOOK-014: the Stripe Connect payment webhook (threat R47, R48, R49, R50).
 * Stripe dashboard: a "connected accounts" endpoint at this path with the
 * events listed in infrastructure/payments/stripe/stripe-events.ts.
 *
 * FAILS CLOSED in every environment (R47): STRIPE_WEBHOOK_SECRET unset, or
 * the adapter not buildable, answers 500 and processes nothing. Do NOT copy
 * the Kapso route's dev fail-open (webhooks/whatsapp/route.ts).
 * A body over 256 KB answers 413 before any signature work (R48): a declared
 * Content-Length is checked first, and the body is read through a reader
 * that stops at the cap, so a chunked body is never fully buffered. The
 * signature is verified on the raw body by the adapter; the rest is
 * processPaymentWebhook (idempotency, mode, matching).
 */
import { NextRequest, NextResponse } from 'next/server'
import { processPaymentWebhook } from '@/application/payments/process-payment-webhook'
import { paymentWebhookDeps } from '@/application/payments/payment-deps'

export const dynamic = 'force-dynamic'

const MAX_PAYMENT_WEBHOOK_BYTES = 256 * 1024

/** The raw body as UTF-8, or null once it passes `max` bytes (reading stops there and the stream is cancelled). */
async function readBodyCapped(request: NextRequest, max: number): Promise<string | null> {
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks, size).toString('utf8')
}

export async function POST(request: NextRequest) {
  if (!process.env.STRIPE_WEBHOOK_SECRET?.trim()) {
    console.error('[Payments] stripe webhook refused: STRIPE_WEBHOOK_SECRET is not set')
    return NextResponse.json({ error: 'not_configured' }, { status: 500 })
  }

  const declared = Number(request.headers.get('content-length') ?? NaN)
  if (Number.isFinite(declared) && declared > MAX_PAYMENT_WEBHOOK_BYTES) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 })
  }
  const rawBody = await readBodyCapped(request, MAX_PAYMENT_WEBHOOK_BYTES)
  if (rawBody === null) return NextResponse.json({ error: 'payload_too_large' }, { status: 413 })

  let deps
  try {
    deps = paymentWebhookDeps('stripe')
  } catch (err) {
    console.error('[Payments] stripe webhook refused: adapter not configured:', (err as Error).name)
    return NextResponse.json({ error: 'not_configured' }, { status: 500 })
  }

  const result = await processPaymentWebhook(deps, { rawBody, headers: request.headers })
  return NextResponse.json(result.body, { status: result.status })
}
