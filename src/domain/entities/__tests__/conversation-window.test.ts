import { describe, it, expect } from 'vitest'
import { ConversationWindow } from '../conversation-window'

const RID = 'rest-1'
const PHONE = '+85291234567'

describe('ConversationWindow.open', () => {
  it('builds a fresh open window with expires_at = openedAt + 24h', () => {
    const now = new Date('2026-05-04T10:00:00.000Z')
    const w = ConversationWindow.open({
      restaurantId: RID,
      phoneE164: PHONE,
      now,
    })
    const s = w.snapshot
    expect(s.restaurantId).toBe(RID)
    expect(s.phoneE164).toBe(PHONE)
    expect(s.openedAt).toBe('2026-05-04T10:00:00.000Z')
    expect(s.lastInboundAt).toBe('2026-05-04T10:00:00.000Z')
    expect(s.expiresAt).toBe('2026-05-05T10:00:00.000Z')
  })

  it('honours custom windowHours', () => {
    const now = new Date('2026-05-04T10:00:00.000Z')
    const w = ConversationWindow.open({
      restaurantId: RID,
      phoneE164: PHONE,
      now,
      windowHours: 1,
    })
    expect(w.snapshot.expiresAt).toBe('2026-05-04T11:00:00.000Z')
  })

  it('defaults now() when omitted', () => {
    const before = Date.now()
    const w = ConversationWindow.open({ restaurantId: RID, phoneE164: PHONE })
    const opened = Date.parse(w.snapshot.openedAt)
    expect(opened).toBeGreaterThanOrEqual(before)
    expect(opened).toBeLessThanOrEqual(Date.now() + 1)
  })

  it('rejects empty restaurantId', () => {
    expect(() =>
      ConversationWindow.open({ restaurantId: '', phoneE164: PHONE })
    ).toThrow(/restaurantId/)
  })

  it('rejects empty phoneE164', () => {
    expect(() =>
      ConversationWindow.open({ restaurantId: RID, phoneE164: '' })
    ).toThrow(/phoneE164/)
  })

  it('assigns a UUID-shaped id', () => {
    const w = ConversationWindow.open({ restaurantId: RID, phoneE164: PHONE })
    expect(w.snapshot.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
  })
})

describe('ConversationWindow.bumpInbound', () => {
  it('returns a NEW instance (immutable) with bumped lastInboundAt + expiresAt; openedAt preserved', () => {
    const opened = new Date('2026-05-04T10:00:00.000Z')
    const original = ConversationWindow.open({
      restaurantId: RID,
      phoneE164: PHONE,
      now: opened,
    })

    const bumpAt = new Date('2026-05-04T15:30:00.000Z')
    const bumped = original.bumpInbound(bumpAt)

    expect(bumped).not.toBe(original)
    // Original untouched
    expect(original.snapshot.lastInboundAt).toBe('2026-05-04T10:00:00.000Z')
    expect(original.snapshot.expiresAt).toBe('2026-05-05T10:00:00.000Z')
    // Bumped advances last_inbound + expires; opened_at preserved
    expect(bumped.snapshot.openedAt).toBe('2026-05-04T10:00:00.000Z')
    expect(bumped.snapshot.lastInboundAt).toBe('2026-05-04T15:30:00.000Z')
    expect(bumped.snapshot.expiresAt).toBe('2026-05-05T15:30:00.000Z')
    // Same id (same logical window)
    expect(bumped.snapshot.id).toBe(original.snapshot.id)
  })

  it('honours custom windowHours on bump', () => {
    const opened = new Date('2026-05-04T10:00:00.000Z')
    const original = ConversationWindow.open({
      restaurantId: RID,
      phoneE164: PHONE,
      now: opened,
    })
    const bumpAt = new Date('2026-05-04T11:00:00.000Z')
    const bumped = original.bumpInbound(bumpAt, 1)
    expect(bumped.snapshot.expiresAt).toBe('2026-05-04T12:00:00.000Z')
  })

  // Defensive: WhatsApp can deliver webhooks out of order. A delayed older
  // inbound arriving after a newer one MUST NOT shrink the tracked window
  // backwards — that would cut Meta's 24h budget short and silently block
  // outbound replies.
  it('returns the same instance when called with an older timestamp (no shrink-back)', () => {
    const opened = new Date('2026-05-04T10:00:00.000Z')
    const original = ConversationWindow.open({
      restaurantId: RID,
      phoneE164: PHONE,
      now: opened,
    })
    // First, advance the window to a newer time.
    const newer = new Date('2026-05-04T15:30:00.000Z')
    const bumped = original.bumpInbound(newer)
    // Now an older delayed webhook arrives.
    const older = new Date('2026-05-04T12:00:00.000Z')
    const result = bumped.bumpInbound(older)
    expect(result).toBe(bumped)
    expect(result.snapshot.lastInboundAt).toBe('2026-05-04T15:30:00.000Z')
    expect(result.snapshot.expiresAt).toBe('2026-05-05T15:30:00.000Z')
  })

  it('returns the same instance when called with the exact same timestamp (no-op)', () => {
    const opened = new Date('2026-05-04T10:00:00.000Z')
    const original = ConversationWindow.open({
      restaurantId: RID,
      phoneE164: PHONE,
      now: opened,
    })
    const result = original.bumpInbound(opened)
    expect(result).toBe(original)
    expect(result.snapshot.lastInboundAt).toBe('2026-05-04T10:00:00.000Z')
    expect(result.snapshot.expiresAt).toBe('2026-05-05T10:00:00.000Z')
  })

  it('advances when called with a newer timestamp (one millisecond is enough)', () => {
    const opened = new Date('2026-05-04T10:00:00.000Z')
    const original = ConversationWindow.open({
      restaurantId: RID,
      phoneE164: PHONE,
      now: opened,
    })
    const justAfter = new Date('2026-05-04T10:00:00.001Z')
    const bumped = original.bumpInbound(justAfter)
    expect(bumped).not.toBe(original)
    expect(bumped.snapshot.lastInboundAt).toBe('2026-05-04T10:00:00.001Z')
    expect(bumped.snapshot.expiresAt).toBe('2026-05-05T10:00:00.001Z')
  })
})

describe('ConversationWindow.isOpenAt', () => {
  it('returns true when when < expiresAt', () => {
    const opened = new Date('2026-05-04T10:00:00.000Z')
    const w = ConversationWindow.open({
      restaurantId: RID,
      phoneE164: PHONE,
      now: opened,
    })
    expect(w.isOpenAt(new Date('2026-05-05T09:59:59.000Z'))).toBe(true)
  })

  it('returns false when when >= expiresAt (boundary closed)', () => {
    const opened = new Date('2026-05-04T10:00:00.000Z')
    const w = ConversationWindow.open({
      restaurantId: RID,
      phoneE164: PHONE,
      now: opened,
    })
    // Exactly at expiry => closed (>=)
    expect(w.isOpenAt(new Date('2026-05-05T10:00:00.000Z'))).toBe(false)
    expect(w.isOpenAt(new Date('2026-05-05T10:00:01.000Z'))).toBe(false)
  })
})

describe('ConversationWindow.fromProps', () => {
  it('round-trips snapshot identity', () => {
    const w1 = ConversationWindow.open({
      restaurantId: RID,
      phoneE164: PHONE,
      now: new Date('2026-05-04T10:00:00.000Z'),
    })
    const w2 = ConversationWindow.fromProps(w1.snapshot)
    expect(w2.snapshot).toEqual(w1.snapshot)
  })
})
