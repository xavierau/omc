// BOOK-009 AC-1 / spec S1.9: the one-paragraph rules summary the admin reads
// and the agents get. Generated from the structured hours only.
import { describe, it, expect } from 'vitest'
import { summarize } from '../booking-hours'
import type { BookingHours, BookingPeriod } from '@/domain/value-objects/booking-hours'

const LUNCH: BookingPeriod = { first: '12:00', last: '14:00' }
const DINNER: BookingPeriod = { first: '18:00', last: '21:30' }
const OPEN = [LUNCH, DINNER]
const CLOSED_WEEK = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }

function hours(patch: Partial<BookingHours> = {}): BookingHours {
  return {
    weekly: { mon: [], tue: OPEN, wed: OPEN, thu: OPEN, fri: OPEN, sat: OPEN, sun: OPEN },
    intervalMinutes: 30,
    noticeHours: 2,
    aheadDays: 30,
    special: [{ date: '2026-12-25', periods: [] }],
    tableMinutes: null,
    terms: { zh_hk: '', en: '' },
    info: { address: '', phone: '', mapUrl: '' },
    ...patch,
  }
}

describe('summarize', () => {
  it('en: the spec S1.9 example', () => {
    expect(summarize(hours(), 8, 'en')).toBe(
      'Diners can book Tue–Sun 12:00–14:00 and 18:00–21:30, every 30 minutes, 2 hours to 30 days ahead, up to 8 people. Closed: 25 Dec.'
    )
  })

  it('zh_hk: the same rules in Chinese', () => {
    expect(summarize(hours(), 8, 'zh_hk')).toBe(
      '可訂座時間：星期二至星期日 12:00–14:00 及 18:00–21:30，每 30 分鐘一節，最少提前 2 小時、最遠 30 日內預約，每枱最多 8 位。休息：12月25日。'
    )
  })

  it('days with different hours are grouped; separate runs are listed', () => {
    const h = hours({
      special: [],
      weekly: { mon: [DINNER], tue: [DINNER], wed: [], thu: [DINNER], fri: [DINNER], sat: OPEN, sun: OPEN },
    })
    expect(summarize(h, 8, 'en')).toContain('Diners can book Mon–Tue, Thu–Fri 18:00–21:30; Sat–Sun 12:00–14:00 and 18:00–21:30,')
    expect(summarize(h, 8, 'zh_hk')).toContain('可訂座時間：星期一至星期二、星期四至星期五 18:00–21:30；星期六至星期日 12:00–14:00 及 18:00–21:30，')
  })

  it('period labels are shown when set', () => {
    const h = hours({ special: [], weekly: { ...CLOSED_WEEK, sat: [{ label: 'Lunch', ...LUNCH }] } })
    expect(summarize(h, 8, 'en')).toContain('Sat Lunch 12:00–14:00,')
  })

  it('special opening dates, table time, no notice and one guest', () => {
    const h = hours({
      noticeHours: 0,
      tableMinutes: 120,
      special: [
        { date: '2026-12-24', label: 'Christmas Eve', periods: [{ first: '12:00', last: '15:00' }] },
        { date: '2026-12-25', periods: [] },
        { date: '2027-01-01', periods: [] },
      ],
    })
    const en = summarize(h, 1, 'en')
    expect(en).toContain('every 30 minutes, up to 30 days ahead, up to 1 person.')
    expect(en).toContain('Closed: 25 Dec, 1 Jan.')
    expect(en).toContain('Special hours: 24 Dec (Christmas Eve) 12:00–15:00.')
    expect(en).toContain('Tables are for 2 hours.')
    const zh = summarize(h, 1, 'zh_hk')
    expect(zh).toContain('每 30 分鐘一節，最遠 30 日內預約，每枱最多 1 位。')
    expect(zh).toContain('休息：12月25日、1月1日。')
    expect(zh).toContain('特別時間：12月24日 (Christmas Eve) 12:00–15:00。')
    expect(zh).toContain('每枱用餐時間 2 小時。')
  })

  it('a table time that is not whole hours is in minutes; one hour notice is singular', () => {
    const h = hours({ tableMinutes: 90, noticeHours: 1, special: [] })
    expect(summarize(h, 8, 'en')).toContain('1 hour to 30 days ahead')
    expect(summarize(h, 8, 'en')).toContain('Tables are for 90 minutes.')
    expect(summarize(h, 8, 'zh_hk')).toContain('每枱用餐時間 90 分鐘。')
  })

  it('no periods anywhere: says no time can be booked', () => {
    const h = hours({ weekly: CLOSED_WEEK, special: [] })
    expect(summarize(h, 8, 'en')).toBe('Diners cannot book any time.')
    expect(summarize(h, 8, 'zh_hk')).toBe('目前沒有可訂座時間。')
  })
})
