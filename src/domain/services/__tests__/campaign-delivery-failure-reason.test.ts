import { describe, it, expect } from 'vitest'
import { deliveryFailureReason } from '../campaign-delivery-failure-reason'

// #131: the reason is tenant-visible. Every branch must name Meta as the
// deciding system and disclaim OhMyClient's own review (WAQ-014 principle).
describe('deliveryFailureReason', () => {
  it('131042 names the Meta billing currency and where to fix it', () => {
    const reason = deliveryFailureReason('131042', 'Business eligibility payment issue')
    expect(reason).toContain('Meta')
    expect(reason).toContain('billing currency')
    expect(reason).toContain('131042')
    expect(reason).toContain('Meta Business Manager')
    expect(reason).toContain('not an OhMyClient')
  })

  it('131047 names the 24-hour window and points at a quick-reply template', () => {
    const reason = deliveryFailureReason('131047', 'Re-engagement message')
    expect(reason).toContain('Meta')
    expect(reason).toContain('24-hour')
    expect(reason).toContain('131047')
    expect(reason).toContain('quick-reply')
    expect(reason).toContain('not an OhMyClient')
  })

  it('unknown code falls back to generic wording carrying code + title', () => {
    const reason = deliveryFailureReason('131026', 'Message undeliverable')
    expect(reason).toContain('Meta')
    expect(reason).toContain('(Meta error 131026: Message undeliverable)')
    expect(reason).toContain('not an OhMyClient')
  })

  it('unknown code without a title carries only the code', () => {
    expect(deliveryFailureReason('999', null)).toContain('(Meta error 999)')
  })

  it('null code omits the parenthetical entirely', () => {
    const reason = deliveryFailureReason(null, null)
    expect(reason).not.toContain('Meta error')
    expect(reason).toContain('Meta')
    expect(reason).toContain('not an OhMyClient')
  })

  it('never leaks raw transport internals', () => {
    const reason = deliveryFailureReason('131042', 'kapso_send_error')
    expect(reason).not.toContain('kapso')
  })
})
