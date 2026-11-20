/**
 * BOOK-009 S2: a date as the diner reads it ("11月21日 (六)" / "Sat 21 Nov"),
 * from the page's messages, so both locales follow the copy file.
 */
import { weekdayKey } from './slot-picker-model'

type Translate = (key: string, values?: Record<string, string | number>) => string

/** `t` is useTranslations('booking'). */
export function dayLabel(t: Translate, date: string): string {
  const month = Number(date.slice(5, 7))
  return t('picker.dayLabel', {
    month: t(`picker.monthsShort.${month}`),
    day: Number(date.slice(8, 10)),
    weekday: t(`picker.weekdays.${weekdayKey(date)}`),
  })
}
