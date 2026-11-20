/**
 * BOOK-010 (spec AC-6): the WhatsApp reply a diner gets when their personal
 * agent's booking was full by the time they sent the confirm code. Free-form
 * text inside the 24 h window their own message just opened; bilingual,
 * like the other in-window booking texts.
 */
import type { SuggestedTime } from './booking-hours'

export interface FullReplyInput {
  date: string
  time: string
  partySize: number
  suggestions: SuggestedTime[]
  /** The diner's booking link, null when none could be made. */
  link: string | null
}

const zhDate = (date: string) => {
  const [, m, d] = date.split('-').map(Number)
  return `${m}月${d}日`
}

export function fullReplyText(input: FullReplyInput): string {
  const { date, time, partySize, suggestions, link } = input
  const zhTimes = suggestions.map((s) => `${zhDate(s.date)} ${s.time}`).join('、')
  const enTimes = suggestions.map((s) => `${s.date} ${s.time}`).join(', ')
  return [
    `抱歉，${zhDate(date)} ${time}（${partySize} 位）剛剛滿了，訂座沒有送出。`,
    ...(zhTimes ? [`仍有位的時間：${zhTimes}`] : []),
    `Sorry, ${date} at ${time} for ${partySize} just filled up, so the booking was not sent to the restaurant.`,
    ...(enTimes ? [`Times with room: ${enTimes}`] : []),
    ...(link ? [`訂座 Book: ${link}`] : []),
  ].join('\n')
}
