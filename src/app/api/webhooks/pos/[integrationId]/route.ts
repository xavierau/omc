import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createWebhookLogger } from '@/infrastructure/logging/logger'
import { processPosWebhook } from '@/application/process-pos-webhook'
import { checkRateLimit } from '@/lib/rate-limit'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ integrationId: string }> }
) {
  const { integrationId } = await params

  const { allowed } = checkRateLimit(`webhook:${integrationId}`, 60, 60_000)
  if (!allowed) {
    return NextResponse.json({ status: 'error', message: 'Rate limit exceeded' }, { status: 429 })
  }

  const log = createWebhookLogger(crypto.randomUUID())

  try {
    const rawBody = await request.text()
    if (rawBody.length > 65536) {
      return NextResponse.json({ status: 'error', message: 'Payload too large' }, { status: 413 })
    }

    log('info', 'pos.webhook.received', {
      integrationId,
      contentType: request.headers.get('content-type'),
      bodySize: rawBody.length,
    })

    const signature = request.headers.get('x-webhook-signature')
      ?? request.headers.get('x-pos-signature')

    const result = await processPosWebhook(integrationId, rawBody, signature, log)

    if (result.status === 'ok' || result.status === 'duplicate') {
      log('info', 'pos.webhook.response', { status: 200, result: result.status })
      return NextResponse.json(result, { status: 200 })
    }

    log('info', 'pos.webhook.response', { status: 200, result: result.status })
    return NextResponse.json({ status: 'ignored', message: 'Webhook ignored' }, { status: 200 })
  } catch (error) {
    log('error', 'pos.webhook.error', { error: String(error) })
    return NextResponse.json({ status: 'error', message: 'Internal error' }, { status: 500 })
  }
}
