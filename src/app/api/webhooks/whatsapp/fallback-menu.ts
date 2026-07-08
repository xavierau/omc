/**
 * Localized copy + the pure fallback-menu builder for the no-keyword reply.
 *
 * WhatsApp reply-buttons cap at 3; when a per-restaurant Contact option pushes
 * the count past 3, the reply must become an interactive LIST instead. This
 * module owns that single presentation rule plus the localized strings, keeping
 * `unknown-help-handlers.ts` thin. No infra imports — pure and unit-testable.
 */

import type { ReplyFeatureKey, ReplyFeatures } from '@/domain/services/reply-config'

export interface MenuOption {
  id: string
  title: string
}

export type FallbackMenu =
  | { kind: 'buttons'; buttons: MenuOption[] }
  | {
      kind: 'list'
      bodyText: string
      buttonText: string
      sections: Array<{
        title?: string
        rows: Array<{ id: string; title: string; description?: string }>
      }>
    }

// --- Localized copy (relocated from unknown-help-handlers.ts) ---

export const UNKNOWN_EN =
  "Sorry, I didn't understand that. Try POINTS / 積分 to check balance, or HELP / 幫助 for options."
export const UNKNOWN_ZH =
  '抱歉，我不明白您的訊息。請輸入 POINTS / 積分 查詢餘額，或 HELP / 幫助 查看選項。'

export const JOIN_INVITE_EN =
  'Welcome! Join our rewards program to earn points on every visit, unlock exclusive coupons, and get special member-only offers.'
export const JOIN_INVITE_ZH =
  '歡迎！加入我們的會員計劃，每次消費賺取積分、解鎖專屬優惠券，並獲取會員尊享禮遇。'

export const OPTIONS_BUTTON_EN = 'Options'
export const OPTIONS_BUTTON_ZH = '選項'

export const MEMBER_OPTIONS_EN: MenuOption[] = [
  { id: 'POINTS', title: 'Check Points' },
  { id: 'REWARDS', title: 'View Rewards' },
  { id: 'HELP', title: 'Help' },
]
export const MEMBER_OPTIONS_ZH: MenuOption[] = [
  { id: 'POINTS', title: '查詢積分' },
  { id: 'REWARDS', title: '查看獎賞' },
  { id: 'HELP', title: '幫助' },
]

export const JOIN_OPTION_EN: MenuOption = { id: 'JOIN', title: 'Join Rewards' }
export const JOIN_OPTION_ZH: MenuOption = { id: 'JOIN', title: '加入會員' }

// --- HELP command text, composed from per-function lines (REPLY-003) ---
// A disabled function drops its line; STOP + LANG are always listed. With every
// function enabled this reproduces the previous fixed HELP copy verbatim.

const HELP_HEADER_EN = 'Available commands:'
const HELP_HEADER_ZH = '可用指令：'

const HELP_FEATURE_LINES_EN: Record<ReplyFeatureKey, string> = {
  points: '• POINTS / 積分 — Check your balance',
  rewards: '• REWARDS / 獎賞 — View rewards',
  redeem: '• REDEEM <code> / 兌換 <代碼> — Use a coupon',
  card: '• CARD / 我的會員碼 — Get your stamp-card QR',
}
const HELP_FEATURE_LINES_ZH: Record<ReplyFeatureKey, string> = {
  points: '• POINTS / 積分 — 查詢餘額',
  rewards: '• REWARDS / 獎賞 — 查看獎賞',
  redeem: '• REDEEM <代碼> / 兌換 <代碼> — 使用優惠券',
  card: '• CARD / 我的會員碼 — 取得您的儲印花會員碼',
}

const HELP_ALWAYS_EN = [
  '• STOP / 退訂 — Unsubscribe',
  '• LANG EN / 語言 中文 — Change language',
]
const HELP_ALWAYS_ZH = [
  '• STOP / 退訂 — 停止接收訊息',
  '• LANG EN / 語言 中文 — 切換語言',
]

const HELP_FEATURE_ORDER: ReplyFeatureKey[] = ['points', 'rewards', 'redeem', 'card']

/**
 * Build the default HELP body for a language, listing only enabled functions.
 * Pure — the tenant's optional custom HELP override is resolved by the caller.
 */
export function buildHelpText(isEn: boolean, features: ReplyFeatures): string {
  const header = isEn ? HELP_HEADER_EN : HELP_HEADER_ZH
  const featureLines = isEn ? HELP_FEATURE_LINES_EN : HELP_FEATURE_LINES_ZH
  const alwaysLines = isEn ? HELP_ALWAYS_EN : HELP_ALWAYS_ZH
  const enabled = HELP_FEATURE_ORDER.filter((key) => features[key]).map(
    (key) => featureLines[key]
  )
  return [header, ...enabled, ...alwaysLines].join('\n')
}

/**
 * Choose buttons vs list purely by option count:
 *   ≤3 → reply buttons; >3 → single untitled-section list.
 */
export function buildFallbackMenu(
  bodyText: string,
  buttonText: string,
  options: MenuOption[]
): FallbackMenu {
  if (options.length <= 3) {
    return { kind: 'buttons', buttons: options }
  }
  return {
    kind: 'list',
    bodyText,
    buttonText,
    sections: [{ rows: options.map((o) => ({ id: o.id, title: o.title })) }],
  }
}
