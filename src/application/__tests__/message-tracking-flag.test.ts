import { describe, it, expect, afterEach } from 'vitest'
import { isMessageTrackingEnabled } from '../message-tracking-flag'

describe('isMessageTrackingEnabled (#131 opt-out flip)', () => {
  const ORIGINAL = process.env.WAQ_TRACK_MESSAGES

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.WAQ_TRACK_MESSAGES
    else process.env.WAQ_TRACK_MESSAGES = ORIGINAL
  })

  it('unset → true (tracking on by default)', () => {
    delete process.env.WAQ_TRACK_MESSAGES
    expect(isMessageTrackingEnabled()).toBe(true)
  })

  it("'1' → true", () => {
    process.env.WAQ_TRACK_MESSAGES = '1'
    expect(isMessageTrackingEnabled()).toBe(true)
  })

  it("'0' → false (explicit opt-out)", () => {
    process.env.WAQ_TRACK_MESSAGES = '0'
    expect(isMessageTrackingEnabled()).toBe(false)
  })

  it('any other value → true (only the literal "0" opts out)', () => {
    process.env.WAQ_TRACK_MESSAGES = 'false'
    expect(isMessageTrackingEnabled()).toBe(true)
  })
})
