import { findPosIntegrationById } from '@/infrastructure/supabase/repositories/pos-integration-repository'
import { parsePosWebhook, verifyPosSignature } from '@/infrastructure/pos/webhook'
import { awardPosPoints } from './award-pos-points'
import { deductPosPoints } from './deduct-pos-points'

type LogFn = (level: 'info' | 'warn' | 'error', event: string, data: unknown) => void
const noop: LogFn = () => {}

interface ProcessResult {
  status: 'ok' | 'ignored' | 'duplicate' | 'error'
  message?: string
}

export async function processPosWebhook(
  integrationId: string,
  rawBody: string,
  signature: string | null,
  log: LogFn = noop
): Promise<ProcessResult> {
  const integration = await findPosIntegrationById(integrationId)
  if (!integration) {
    log('warn', 'pos.integration_not_found', { integrationId })
    return { status: 'ignored', message: 'Webhook ignored' }
  }

  if (integration.status !== 'active') {
    log('warn', 'pos.integration_inactive', { integrationId })
    return { status: 'ignored', message: 'Webhook ignored' }
  }

  if (!integration.webhookSecret) {
    log('warn', 'pos.no_webhook_secret', { integrationId })
    return { status: 'ignored', message: 'Webhook ignored' }
  }

  if (!signature) {
    log('warn', 'pos.missing_signature', { integrationId })
    return { status: 'error', message: 'Missing webhook signature' }
  }

  const valid = verifyPosSignature(integration.provider, rawBody, signature, integration.webhookSecret)
  if (!valid) {
    log('warn', 'pos.invalid_signature', { integrationId })
    return { status: 'error', message: 'Invalid signature' }
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    log('warn', 'pos.invalid_json', { integrationId })
    return { status: 'error', message: 'Invalid JSON body' }
  }
  const event = parsePosWebhook(integration.provider, body, integration.fieldMapping ?? undefined)
  if (!event) {
    log('info', 'pos.parse_failed', { integrationId })
    return { status: 'ignored', message: 'Could not parse webhook payload' }
  }

  log('info', 'pos.event_parsed', { type: event.type, txId: event.externalTransactionId })

  const result = event.type === 'sale'
    ? await awardPosPoints(event, integration)
    : await deductPosPoints(event, integration)

  if (!result.transactionId) {
    log('info', 'pos.duplicate', { txId: event.externalTransactionId })
    return { status: 'duplicate' }
  }

  const points = 'pointsAwarded' in result ? result.pointsAwarded : result.pointsDeducted
  log('info', 'pos.processed', { type: event.type, txId: result.transactionId, points })
  return { status: 'ok' }
}
