// F5 (review #3): a repeat BOOK reuses the diner's live chat link only when it
// has no expiry or at least one hour left; a link about to die gets replaced,
// so the diner is never sent a link that expires before they can use it.
import { describe, it, expect } from 'vitest'
import { CHAT_LINK_REUSE_MIN_MS, isReusableChatLink } from '../booking-token'

const NOW = new Date('2026-11-12T10:00:00.000Z')
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString()

describe('isReusableChatLink', () => {
  it('reuses a link with no expiry', () => {
    expect(isReusableChatLink(null, NOW)).toBe(true)
  })

  it('reuses a link with exactly one hour left, not one millisecond less', () => {
    expect(CHAT_LINK_REUSE_MIN_MS).toBe(3_600_000)
    expect(isReusableChatLink(at(3_600_000), NOW)).toBe(true)
    expect(isReusableChatLink(at(3_599_999), NOW)).toBe(false)
  })

  it('never reuses an expired or unreadable expiry', () => {
    expect(isReusableChatLink(at(-1), NOW)).toBe(false)
    expect(isReusableChatLink('not-a-date', NOW)).toBe(false)
  })
})
