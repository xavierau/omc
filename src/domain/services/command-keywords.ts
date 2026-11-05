/**
 * Bilingual inbound keyword matcher.
 *
 * Exact-match lookup against a locked synonym list. ASCII-only strings are
 * uppercased before comparison; CJK strings are preserved as-is (CJK has no
 * case). Whitespace is trimmed and collapsed. No fuzzy or contains-match.
 *
 * Pure: zero infra imports, safe to call from any layer.
 */

export type CommandRoute =
  | 'POINTS'
  | 'HELP'
  | 'STOP'
  | 'YES'
  | 'NO'
  | 'REWARDS'
  | 'REDEEM'
  | 'MY_CARD'
  | 'CONTACT'

const KEYWORDS: Record<CommandRoute, readonly string[]> = {
  POINTS: ['POINTS', '積分', '查積分', '查詢積分'],
  HELP: ['HELP', '幫助', '說明'],
  STOP: ['STOP', '退訂', '停止'],
  YES: ['YES', 'Y', '是', '確認', '確定'],
  NO: ['NO', 'N', '否', '取消'],
  REWARDS: ['REWARDS', 'REWARD', '獎賞', '兌換項目'],
  REDEEM: ['REDEEM', '兌換'],
  MY_CARD: ['CARD', 'QR', '我的會員碼', '會員碼', '我嘅會員碼', '我張卡', '會員卡'],
  CONTACT: ['CONTACT', '客服', '聯絡', '聯絡我們', '聯繫'],
}

const ASCII_ONLY = /^[\x00-\x7F]+$/

function normalize(text: string): string {
  const collapsed = text.trim().replace(/\s+/g, ' ')
  if (collapsed.length === 0) return ''
  return ASCII_ONLY.test(collapsed) ? collapsed.toUpperCase() : collapsed
}

export function matchCommand(
  text: string | null | undefined
): CommandRoute | null {
  if (text == null) return null
  const normalized = normalize(text)
  if (normalized.length === 0) return null

  for (const route of Object.keys(KEYWORDS) as CommandRoute[]) {
    if (KEYWORDS[route].includes(normalized)) return route
  }
  return null
}
