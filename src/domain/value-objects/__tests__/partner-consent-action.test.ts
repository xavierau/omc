import { describe, expect, it } from 'vitest'
import { isPartnerConsentAction } from '../partner-consent-action'

describe('isPartnerConsentAction', () => {
  it.each(['inserted', 'upgraded', 'noop', 'blocked_opted_out'])(
    'accepts %s',
    (value) => {
      expect(isPartnerConsentAction(value)).toBe(true)
    }
  )

  it.each([undefined, null, 42, 'unknown', ''])('rejects %s', (value) => {
    expect(isPartnerConsentAction(value)).toBe(false)
  })
})
