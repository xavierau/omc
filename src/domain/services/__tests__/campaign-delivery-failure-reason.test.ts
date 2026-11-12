import { describe, it, expect } from 'vitest'
import {
  deliveryFailureReason,
  deliveryUnknownReason,
  isDeliveryUnknownReason,
} from '../campaign-delivery-failure-reason'
import { FAILURE_REASON_MAX_LEN } from '@/application/campaign-guardrail-error'
import { normalizeStatusPayload } from '@/infrastructure/whatsapp/webhooks'
import { mapStatusUpdate } from '@/app/api/webhooks/whatsapp/status-mapper'
import restrictedPayload from '@/infrastructure/whatsapp/__tests__/fixtures/kapso-v2-failed-131042-restricted.json'
import currencyPayload from '@/infrastructure/whatsapp/__tests__/fixtures/kapso-v2-failed-131042.json'

const TITLE = 'Business eligibility payment issue'
const BILLING = 'Meta Business Manager → Billing & payments'
const RESTRICTED =
  'Message failed to send because your WhatsApp Business account payment has been restricted. Visit https://business.facebook.com/billing_hub/... to resolve this issue.'
const CURRENCY =
  'Message failed to send because your WhatsApp Business account currency is not configured. Visit https://business.facebook.com/billing_hub/... to resolve this issue.'
const PAYMENT_METHOD =
  'Message failed to send because there were one or more errors related to your payment method. Visit https://business.facebook.com/billing_hub/... to resolve this issue.'

// #131: the reason is tenant-visible. Every branch must name Meta as the
// deciding system and disclaim OhMyClient's own review (WAQ-014 principle).
describe('deliveryFailureReason', () => {
  describe('131042 branches on what Meta actually said (CAMP-014)', () => {
    it('the real restricted detail gets the payment-restricted wording, never a currency claim', () => {
      const reason = deliveryFailureReason('131042', TITLE, RESTRICTED)
      expect(reason).toContain('restricted')
      expect(reason).not.toMatch(/currency/i)
    })

    it('the real currency detail keeps the currency wording', () => {
      const reason = deliveryFailureReason('131042', TITLE, CURRENCY)
      expect(reason).toContain('billing currency')
      expect(reason).not.toContain('restricted')
    })

    it('the payment-method detail gets its own wording', () => {
      const reason = deliveryFailureReason('131042', TITLE, PAYMENT_METHOD)
      expect(reason).toContain('payment method')
      expect(reason).not.toMatch(/currency/i)
      expect(reason).not.toContain('restricted')
    })

    it.each([[null], ['Something new Meta has never said before']])(
      'detail %s gets the generic wording, asserting no cause Meta did not state',
      (details) => {
        const reason = deliveryFailureReason('131042', TITLE, details)
        expect(reason).toContain(
          'payment problem on the WhatsApp Business account (Meta error 131042)'
        )
        expect(reason).not.toMatch(/currency/i)
        expect(reason).not.toContain('restricted')
      }
    )

    it('matches case-insensitively', () => {
      expect(deliveryFailureReason('131042', TITLE, 'PAYMENT HAS BEEN RESTRICTED')).toContain('restricted')
    })

    it.each([[RESTRICTED], [CURRENCY], [PAYMENT_METHOD], [null]])(
      'detail %s names WhatsApp (Meta), the billing page, the code and the disclaimer',
      (details) => {
        const reason = deliveryFailureReason('131042', TITLE, details)
        expect(reason).toContain('WhatsApp (Meta)')
        expect(reason).toContain(BILLING)
        expect(reason).toContain('131042')
        expect(reason).toContain('not an OhMyClient')
      }
    )

    it('never echoes Meta raw detail text', () => {
      for (const details of [RESTRICTED, CURRENCY, PAYMENT_METHOD, 'raw meta words']) {
        const reason = deliveryFailureReason('131042', TITLE, details)
        expect(reason).not.toContain(details)
        expect(reason).not.toContain('billing_hub')
      }
    })

    // Real shapes through the real parser: a fix that reads the wrong field
    // would pass the string cases above and still word every row as generic.
    it('words the real webhook payloads through the status mapper', () => {
      const reasonFor = (payload: unknown) => {
        const out = mapStatusUpdate(normalizeStatusPayload(payload)[0])
        return deliveryFailureReason(out.errorCode ?? null, out.errorTitle ?? null, out.errorDetails ?? null)
      }
      expect(reasonFor(restrictedPayload)).toContain('restricted')
      expect(reasonFor(restrictedPayload)).not.toMatch(/currency/i)
      expect(reasonFor(currencyPayload)).toContain('billing currency')
    })
  })

  describe('131047', () => {
    it('names the 24-hour window and points at a new campaign with a quick-reply template', () => {
      const reason = deliveryFailureReason('131047', 'Re-engagement message', null)
      expect(reason).toContain('Meta')
      expect(reason).toContain('24-hour')
      expect(reason).toContain('131047')
      expect(reason).toContain('quick-reply')
      expect(reason).toContain('new campaign')
      expect(reason).toContain('not an OhMyClient')
    })

    it('does not tell the tenant to re-run: a failed campaign cannot change template', () => {
      expect(deliveryFailureReason('131047', 'Re-engagement message', null)).not.toMatch(/re-run/i)
    })
  })

  it('unknown code falls back to generic wording carrying code + title', () => {
    const reason = deliveryFailureReason('131026', 'Message undeliverable', null)
    expect(reason).toContain('Meta')
    expect(reason).toContain('(Meta error 131026: Message undeliverable)')
    expect(reason).toContain('not an OhMyClient')
  })

  it('unknown code without a title carries only the code', () => {
    expect(deliveryFailureReason('999', null, null)).toContain('(Meta error 999)')
  })

  it('null code omits the parenthetical entirely', () => {
    const reason = deliveryFailureReason(null, null, null)
    expect(reason).not.toContain('Meta error')
    expect(reason).toContain('Meta')
    expect(reason).toContain('not an OhMyClient')
  })

  it('never leaks raw transport internals', () => {
    const reason = deliveryFailureReason('131042', 'kapso_send_error', null)
    expect(reason).not.toContain('kapso')
  })

  it('every reason fits FAILURE_REASON_MAX_LEN, whatever Meta sends', () => {
    const long = 'x'.repeat(5000)
    const reasons = [
      ...[RESTRICTED, CURRENCY, PAYMENT_METHOD, null, long].map((d) =>
        deliveryFailureReason('131042', TITLE, d)
      ),
      deliveryFailureReason('131047', long, long),
      deliveryFailureReason('131026', long, long),
      deliveryFailureReason(null, null, null),
    ]
    for (const reason of reasons) {
      expect(reason.length).toBeLessThanOrEqual(FAILURE_REASON_MAX_LEN)
    }
  })
})

describe('delivery-unknown reason', () => {
  it('the wording warns against a blind re-run and the predicate recognises it', () => {
    const reason = deliveryUnknownReason(5, 2)
    expect(reason).toContain('delivery could not be confirmed for 2 of them')
    expect(reason).toContain('Contact support')
    expect(isDeliveryUnknownReason(reason)).toBe(true)
  })

  it('does not match any other failure reason', () => {
    for (const reason of [
      deliveryFailureReason('131042', TITLE, RESTRICTED),
      deliveryFailureReason('131047', null, null),
      deliveryFailureReason(null, null, null),
      'All 3 message sends failed.',
      'Campaign send failed due to an unexpected error. Contact support if this persists.',
    ]) {
      expect(isDeliveryUnknownReason(reason)).toBe(false)
    }
  })

  it.each([[null], [undefined], ['']])('treats %s as not delivery-unknown', (reason) => {
    expect(isDeliveryUnknownReason(reason)).toBe(false)
  })
})
