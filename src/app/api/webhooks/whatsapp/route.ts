import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import {
  classifyWebhookKind,
  parseKapsoWebhook,
  verifyKapsoSignature,
} from '@/infrastructure/whatsapp/webhooks'
import { createWebhookLogger } from '@/infrastructure/logging/logger'
import { findByPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { tryMarkProcessed } from '@/infrastructure/supabase/idempotency'
import { routeMessage } from './handlers'
import { routeStatusEvent } from './status-handlers'

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
    const restaurantId = await resolveRestaurant(body, log)
    if (!restaurantId) {
      log('warn', 'webhook.unknown_restaurant', { reason: 'no matching restaurant' })
      return NextResponse.json({ status: 'ignored' })
    }

    const kind = classifyWebhookKind(body)
    log('info', 'webhook.kind', { kind })

    if (kind === 'status') {
      await routeStatusEvent(body, restaurantId, log)
      log('info', 'webhook.response', { status: 200, kind })
      return NextResponse.json({ status: 'ok' })
    }

    if (kind === 'inbound') {
      return handleInbound(request, body, restaurantId, log)
    }

    log('info', 'webhook.ignored', { reason: 'unrecognised payload' })
    return NextResponse.json({ status: 'ignored' })
  } catch (error) {
    log('error', 'webhook.error', { error: String(error) })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

async function handleInbound(
  request: NextRequest,
  body: unknown,
  restaurantId: string,
  log: LogFn
): Promise<NextResponse> {
  const webhookHeaders = {
    'x-idempotency-key': request.headers.get('x-idempotency-key') ?? undefined,
  }
  const message = parseKapsoWebhook(body, webhookHeaders, log)
  if (!message) {
    log('info', 'webhook.ignored', { reason: 'parse returned null' })
    return NextResponse.json({ status: 'ignored' })
  }

  const claim = await tryMarkProcessed(message.messageId, log)
  if (claim === 'duplicate') return NextResponse.json({ status: 'duplicate' })

  await routeMessage(message, restaurantId, log)
  log('info', 'webhook.response', { status: 200 })
  return NextResponse.json({ status: 'ok' })
}

function extractPhoneNumberId(body: unknown): string | null {
  const payload = body as Record<string, unknown>

  // Kapso format: conversation.phone_number_id
  const conversation = payload?.conversation as Record<string, unknown> | undefined
  if (conversation?.phone_number_id) {
    return conversation.phone_number_id as string
  }

  // Meta Cloud API format: entry[].changes[].value.metadata.phone_number_id
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
  const signature = request.headers.get('x-webhook-signature') ?? request.headers.get('x-kapso-signature')
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
