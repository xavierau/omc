// BOOK-009 F1 (review P2-1 ruling): the AI reply agent with the booking-hours
// schedule switch off: no schedule lines, no "offer suggestedTimes" rule, and
// its tools take any time; terms (read back) and table time still apply. Off
// with nothing else set is exactly the pre-BOOK-009 prompt (AC-5).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { buildSystemInstruction } from '@/application/agent/agent-prompt'
import { AGENT_TOOL_NAMES } from '@/domain/value-objects/agent-config'
import { EMPTY_BOOKING_HOURS, type BookingHours } from '@/domain/value-objects/booking-hours'

const FIXTURE = JSON.parse(readFileSync(join(__dirname, 'fixtures/system-instruction-hours-null.json'), 'utf8')) as Record<string, string>
const NOW = new Date('2026-11-19T10:00:00.000Z')
const AGENT = { instructions: 'Be warm.', knowledge: 'Open daily 12:00-22:00.' }
const NOTES = 'Large groups: set menu only.'
const all = [...AGENT_TOOL_NAMES]
const daily = [{ first: '18:00', last: '21:00' }]
const OFF: BookingHours = {
  ...EMPTY_BOOKING_HOURS,
  scheduleEnabled: false,
  weekly: { mon: daily, tue: daily, wed: daily, thu: daily, fri: daily, sat: daily, sun: daily },
}
const prompt = (hours: BookingHours) => buildSystemInstruction(AGENT, NOW, { offeredTools: all, bookingRules: NOTES, bookingHours: hours, maxPartySize: 8 })

describe('AI prompt with the schedule switch off', () => {
  it('nothing else set → exactly the hours-null instruction', () => {
    expect(prompt(OFF)).toBe(FIXTURE.withRules)
  })

  it('terms and table time → no schedule summary or suggestedTimes rule; table time, terms and read-back present', () => {
    const text = prompt({ ...OFF, tableMinutes: 120, terms: { zh_hk: '訂座保留 15 分鐘。', en: '' } })
    expect(text).not.toContain('可訂座時間')
    expect(text).not.toContain('suggestedTimes')
    expect(text).toContain('每枱用餐時間 2 小時。')
    expect(text).toContain('訂座須知 Booking terms:\n訂座保留 15 分鐘。')
    expect(text).toContain('read them back with the details')
    expect(text).toContain(`Other booking notes:\n${NOTES}`)
  })

  it('switch on → the schedule summary and the suggestedTimes rule come back', () => {
    const text = prompt({ ...OFF, scheduleEnabled: true })
    expect(text).toContain('可訂座時間')
    expect(text).toContain('suggestedTimes')
  })
})
