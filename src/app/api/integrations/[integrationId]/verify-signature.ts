import crypto from 'crypto'
import { findPosIntegrationById } from '@/infrastructure/supabase/repositories/pos-integration-repository'
import type { PosIntegration } from '@/domain/entities/pos-integration'

export class IntegrationAuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message)
  }
}

export async function authenticateIntegration(
  integrationId: string,
  rawBody: string,
  signature: string | null
): Promise<PosIntegration> {
  const integration = await findPosIntegrationById(integrationId)
  if (!integration || integration.status !== 'active') {
    console.warn(`[Auth] Integration lookup failed: id=${integrationId}, found=${!!integration}, status=${integration?.status}`)
    throw new IntegrationAuthError('Authentication failed', 401)
  }

  if (!integration.webhookSecret) {
    throw new IntegrationAuthError('Authentication failed', 401)
  }

  validateSignature(integration.webhookSecret, rawBody, signature)

  return integration
}

function validateSignature(
  secret: string,
  rawBody: string,
  signature: string | null
): void {
  if (!signature) {
    throw new IntegrationAuthError('Authentication failed', 401)
  }

  const sigHex = signature.startsWith('sha256=') ? signature.slice(7) : signature
  const expectedHex = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex')

  const sigBuffer = Buffer.from(sigHex, 'hex')
  const expectedBuffer = Buffer.from(expectedHex, 'hex')

  if (
    sigBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    throw new IntegrationAuthError('Authentication failed', 401)
  }
}
