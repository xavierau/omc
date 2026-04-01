import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { parseKapsoWebhook, verifyKapsoSignature } from '@/infrastructure/kapso/webhook-parser'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { createWebhookLogger } from '@/infrastructure/logging/logger'
import { findByPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { routeMessage } from './handlers'

export async function POST(request: NextRequest) {
  const log = createWebhookLogger(crypto.randomUUID())
  try {
    const rawBody = await request.text()
    log('info', 'webhook.received', {
      method: request.method,
      contentType: request.headers.get('content-type'),
      bodySize: rawBody.length,
    })

    const sigValid = verifySignature(request, rawBody)
    log('info', 'webhook.signature', { valid: sigValid })
    if (!sigValid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const body = JSON.parse(rawBody)
    const webhookHeaders = {
      'x-idempotency-key': request.headers.get('x-idempotency-key') ?? undefined,
    }
    const message = parseKapsoWebhook(body, webhookHeaders, log)
    if (!message) {
      log('info', 'webhook.ignored', { reason: 'parse returned null' })
      return NextResponse.json({ status: 'ignored' })
    }

    const restaurantId = await resolveRestaurant(body, log)
    if (!restaurantId) {
      log('warn', 'webhook.unknown_restaurant', { reason: 'no matching restaurant' })
      return NextResponse.json({ status: 'ignored' })
    }

    const duplicateResponse = await tryMarkProcessed(message.messageId, log)
    if (duplicateResponse) return duplicateResponse

    await routeMessage(message, restaurantId, log)
    log('info', 'webhook.response', { status: 200 })
    return NextResponse.json({ status: 'ok' })
  } catch (error) {
    log('error', 'webhook.error', { error: String(error) })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

function extractPhoneNumberId(body: unknown): string | null {
  const payload = body as Record<string, unknown>
  const entry = (payload?.entry as Array<Record<string, unknown>>)?.[0]
  const changes = (entry?.changes as Array<Record<string, unknown>>)?.[0]
  const value = changes?.value as Record<string, unknown> | undefined
  const metadata = value?.metadata as Record<string, unknown> | undefined
  return (metadata?.phone_number_id as string) ?? null
}

type LogFn = (level: 'info' | 'warn' | 'error', event: string, data: unknown) => void

async function resolveRestaurant(body: unknown, log: LogFn): Promise<string | null> {
  const phoneNumberId = extractPhoneNumberId(body)
  if (!phoneNumberId) {
    log('warn', 'webhook.no_phone_number_id', {})
    return null
  }

  const restaurant = await findByPhoneNumberId(phoneNumberId)
  if (!restaurant) {
    log('warn', 'webhook.restaurant_not_found', { phoneNumberId })
    return null
  }

  return restaurant.id
}

function verifySignature(request: NextRequest, rawBody: string): boolean {
  const secret = process.env.KAPSO_WEBHOOK_SECRET
  const signature = request.headers.get('x-kapso-signature')
  const isProduction = process.env.NODE_ENV === 'production'

  if (!secret) {
    if (isProduction) {
      console.warn('KAPSO_WEBHOOK_SECRET not configured in production (demo mode)')
    }
    return true
  }

  if (!signature) {
    if (!isProduction) return true
    return false
  }

  return verifyKapsoSignature(rawBody, signature, secret)
}

async function tryMarkProcessed(messageId: string, log: LogFn): Promise<NextResponse | null> {
  const supabase = createServerSupabaseClient()

  const { error } = await supabase
    .from('processed_webhooks')
    .insert({ idempotency_key: messageId })

  if (!error) {
    log('info', 'webhook.idempotency', { status: 'new', messageId })
    return null
  }

  if (error.code === '23505') {
    log('info', 'webhook.idempotency', { status: 'duplicate', messageId })
    return NextResponse.json({ status: 'duplicate' })
  }

  log('error', 'webhook.idempotency', { status: 'error', error: error.message })
  return null
}
