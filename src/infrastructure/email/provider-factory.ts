import { resendEmailAdapter } from './resend/resend-adapter'
import type { EmailPort } from '@/domain/ports/email'

let emailInstance: EmailPort | null = null

const KNOWN_PROVIDERS = new Set(['resend'])

function getProvider(): string {
  const provider = process.env.EMAIL_PROVIDER ?? 'resend'
  if (!KNOWN_PROVIDERS.has(provider)) {
    throw new Error(`Unknown email provider: "${provider}". Valid: ${[...KNOWN_PROVIDERS].join(', ')}`)
  }
  return provider
}

function createEmail(provider: string): EmailPort {
  if (provider === 'resend') return resendEmailAdapter
  throw new Error(`No email adapter for provider: ${provider}`)
}

export function getEmailProvider(): EmailPort {
  if (!emailInstance) emailInstance = createEmail(getProvider())
  return emailInstance
}

export function _resetProviders(): void {
  emailInstance = null
}
