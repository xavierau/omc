/**
 * BOOK-014 (spec AC-15; threat R51): adapters by provider code. Each adapter
 * is built on first use and kept for the process; a provider that is not
 * configured throws on `get`, so callers fail closed (no deposit can start,
 * the webhook answers 500).
 *
 * Production registers Stripe only. The test adapter is never registered
 * here: tests build their own registry with it.
 */
import type { PaymentGatewayPort, PaymentGatewayRegistry, PaymentProviderCode } from '@/domain/ports/payment-gateway'
import { stripeGatewayFromEnv } from './stripe/stripe-gateway'

export class PaymentProviderNotConfiguredError extends Error {
  constructor(code: string) {
    super(`payment provider ${code} is not configured`)
    this.name = 'PaymentProviderNotConfiguredError'
  }
}

export function createPaymentGatewayRegistry(
  factories: Partial<Record<PaymentProviderCode, () => PaymentGatewayPort>>
): PaymentGatewayRegistry {
  const built = new Map<PaymentProviderCode, PaymentGatewayPort>()
  return {
    get(code) {
      const existing = built.get(code)
      if (existing) return existing
      const factory = factories[code]
      if (!factory) throw new PaymentProviderNotConfiguredError(code)
      const gateway = factory()
      if (gateway.code !== code) throw new PaymentProviderNotConfiguredError(code)
      built.set(code, gateway)
      return gateway
    },
  }
}

let production: PaymentGatewayRegistry | null = null

/** The process-wide registry (Stripe from STRIPE_* env). A failed build is retried on the next call. */
export function productionPaymentRegistry(): PaymentGatewayRegistry {
  production ??= createPaymentGatewayRegistry({ stripe: () => stripeGatewayFromEnv() })
  return production
}
