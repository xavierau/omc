/**
 * BOOK-014 (threat R50, R63): the Stripe settings, read once when the adapter
 * is built. All three are required; a missing one, an unknown mode, or a key
 * whose prefix is for the other mode (sk_test_/rk_test_ in live, or the
 * reverse) makes construction throw, so no payment path runs half-configured.
 * Names only here; values live in .env.local / Forge env, never NEXT_PUBLIC_.
 */
export type StripeMode = 'test' | 'live'

export interface StripeSettings {
  secretKey: string
  webhookSecret: string
  mode: StripeMode
}

export class StripeConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StripeConfigError'
  }
}

const KEY = /^(sk|rk)_(test|live)_[A-Za-z0-9]+$/

export function parseStripeSettings(env: Record<string, string | undefined>): StripeSettings {
  const secretKey = env.STRIPE_SECRET_KEY?.trim() ?? ''
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim() ?? ''
  const mode = env.STRIPE_MODE?.trim()
  if (!secretKey) throw new StripeConfigError('STRIPE_SECRET_KEY is not set')
  if (!webhookSecret) throw new StripeConfigError('STRIPE_WEBHOOK_SECRET is not set')
  if (mode !== 'test' && mode !== 'live') throw new StripeConfigError('STRIPE_MODE must be test or live')
  const key = KEY.exec(secretKey)
  if (!key) throw new StripeConfigError('STRIPE_SECRET_KEY is not a Stripe secret or restricted key')
  if (key[2] !== mode) throw new StripeConfigError(`STRIPE_SECRET_KEY is a ${key[2]} key but STRIPE_MODE is ${mode}`)
  if (!webhookSecret.startsWith('whsec_')) throw new StripeConfigError('STRIPE_WEBHOOK_SECRET is not a webhook signing secret')
  return { secretKey, webhookSecret, mode }
}
