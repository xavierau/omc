/**
 * BOOK-009 spec S1.9: the rules as one paragraph, generated from the
 * structured hours. The settings page shows it, and the AI agent and the
 * personal-agent API get the same text, so the admin reads what agents get.
 *
 * Weekdays with the same periods are grouped ("Tue–Sun 12:00–14:00 and
 * 18:00–21:30"); special dates are listed as Closed or Special hours.
 */
import type { BookingHours, BookingHoursLanguage, BookingPeriod, Weekday } from '@/domain/value-objects/booking-hours'
import { WEEKDAYS } from '@/domain/value-objects/booking-hours'

interface Copy {
  day: Record<Weekday, string>
  to: string
  dayJoin: string
  groupJoin: string
  periodJoin: string
  date(month: number, day: number): string
  rules(weekly: string | null, interval: number, notice: number, ahead: number, party: number): string
  closed(list: string): string
  special(list: string): string
  table(minutes: number): string
  none: string
  space: string
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const enTable = (m: number) => (m % 60 === 0 ? plural(m / 60, 'hour', 'hours') : `${m} minutes`)

const EN: Copy = {
  day: { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' },
  to: '–', dayJoin: ', ', groupJoin: '; ', periodJoin: ' and ', space: ' ',
  date: (month, day) => `${day} ${MONTHS[month - 1]}`,
  rules: (weekly, interval, notice, ahead, party) =>
    `Diners can book ${weekly ?? 'only on the special dates below'}, every ${interval} minutes, ` +
    `${notice > 0 ? `${plural(notice, 'hour', 'hours')} to` : 'up to'} ${ahead} days ahead, up to ${plural(party, 'person', 'people')}.`,
  closed: (list) => `Closed: ${list}.`,
  special: (list) => `Special hours: ${list}.`,
  table: (m) => `Tables are for ${enTable(m)}.`,
  none: 'Diners cannot book any time.',
}

const ZH: Copy = {
  day: { mon: '星期一', tue: '星期二', wed: '星期三', thu: '星期四', fri: '星期五', sat: '星期六', sun: '星期日' },
  to: '至', dayJoin: '、', groupJoin: '；', periodJoin: ' 及 ', space: '',
  date: (month, day) => `${month}月${day}日`,
  rules: (weekly, interval, notice, ahead, party) =>
    `可訂座時間：${weekly ?? '只限以下特別日子'}，每 ${interval} 分鐘一節，` +
    `${notice > 0 ? `最少提前 ${notice} 小時、` : ''}最遠 ${ahead} 日內預約，每枱最多 ${party} 位。`,
  closed: (list) => `休息：${list}。`,
  special: (list) => `特別時間：${list}。`,
  table: (m) => `每枱用餐時間 ${m % 60 === 0 ? `${m / 60} 小時` : `${m} 分鐘`}。`,
  none: '目前沒有可訂座時間。',
}

const COPY: Record<BookingHoursLanguage, Copy> = { en: EN, zh_hk: ZH }

const periodText = (p: BookingPeriod) => `${p.label ? `${p.label} ` : ''}${p.first}–${p.last}`
const periodsText = (c: Copy, periods: BookingPeriod[]) => periods.map(periodText).join(c.periodJoin)

/** Consecutive weekdays as runs: [mon, tue, thu] → "Mon–Tue, Thu". */
function daysText(c: Copy, days: Weekday[]): string {
  const runs: Weekday[][] = []
  for (const day of days) {
    const run = runs[runs.length - 1]
    const follows = run && WEEKDAYS.indexOf(day) === WEEKDAYS.indexOf(run[run.length - 1]) + 1
    if (follows) run.push(day)
    else runs.push([day])
  }
  return runs.map((r) => (r.length === 1 ? c.day[r[0]] : `${c.day[r[0]]}${c.to}${c.day[r[r.length - 1]]}`)).join(c.dayJoin)
}

/** Open weekdays grouped by identical periods, in weekday order; null when every weekday is closed. */
function weeklyText(c: Copy, hours: BookingHours): string | null {
  const groups = new Map<string, Weekday[]>()
  for (const day of WEEKDAYS) {
    const periods = hours.weekly[day]
    if (periods.length > 0) groups.set(periodsText(c, periods), [...(groups.get(periodsText(c, periods)) ?? []), day])
  }
  if (groups.size === 0) return null
  return [...groups.entries()].map(([periods, days]) => `${daysText(c, days)} ${periods}`).join(c.groupJoin)
}

function dateText(c: Copy, date: string, label?: string): string {
  const [, month, day] = date.split('-').map(Number)
  return `${c.date(month, day)}${label ? ` (${label})` : ''}`
}

function specialSentences(c: Copy, hours: BookingHours): string[] {
  const closed = hours.special.filter((s) => s.periods.length === 0).map((s) => dateText(c, s.date, s.label))
  const open = hours.special
    .filter((s) => s.periods.length > 0)
    .map((s) => `${dateText(c, s.date, s.label)} ${periodsText(c, s.periods)}`)
  return [
    ...(closed.length > 0 ? [c.closed(closed.join(c.dayJoin))] : []),
    ...(open.length > 0 ? [c.special(open.join(c.groupJoin))] : []),
  ]
}

/** The booking rules in one paragraph, in `lang` (spec S1.9). */
export function summarize(hours: BookingHours, maxPartySize: number, lang: BookingHoursLanguage): string {
  const c = COPY[lang]
  const weekly = weeklyText(c, hours)
  if (!weekly && !hours.special.some((s) => s.periods.length > 0)) return c.none
  const sentences = [
    c.rules(weekly, hours.intervalMinutes, hours.noticeHours, hours.aheadDays, maxPartySize),
    ...specialSentences(c, hours),
    ...(hours.tableMinutes ? [c.table(hours.tableMinutes)] : []),
  ]
  return sentences.join(c.space)
}
