/**
 * Bilingual adapter-layer reply copy for inbound WhatsApp commands.
 *
 * Each key has an `en` and `zhHk` entry — either a literal string or a
 * template function that accepts interpolation vars. The caller passes the
 * resolved {@link Language} and the vars; this module is pure and does no IO.
 *
 * Scope is adapter-layer chrome (non-member prompt, balance reply, rewards
 * header, unsubscribe ack, receipt ack, button labels). Use-case-specific
 * copy (coupon redemption outcomes, reward redemption celebration, receipt
 * rejection reasons) lives in `src/application/messages/` alongside the
 * use case that owns it.
 */
import { Language } from '@/domain/value-objects/language'

type ReplyTemplate<V> = V extends void ? string : (vars: V) => string

interface ReplyEntry<V> {
  en: ReplyTemplate<V>
  zhHk: ReplyTemplate<V>
}

type NoVars = void
interface PointsVars { points: number }
interface CantAffordVars { points: number; name: string; cost: number }
interface RewardButtonVars { name: string; cost: number }
interface ClaimReadyVars { code: string }

export interface ReplyVarsMap {
  nonMember: NoVars
  balance: PointsVars
  unsubscribed: NoVars
  rewardsEmpty: NoVars
  rewardsHeader: PointsVars
  cantAfford: CantAffordVars
  receiptAck: NoVars
  receiptImageMissing: NoVars
  buttonPoints: NoVars
  buttonRewards: NoVars
  buttonHelp: NoVars
  rewardButton: RewardButtonVars
  campaignUnavailable: NoVars
  claimReady: ClaimReadyVars
}

export type ReplyKey = keyof ReplyVarsMap

type Replies = {
  [K in ReplyKey]: ReplyEntry<ReplyVarsMap[K]>
}

const REPLIES: Replies = {
  nonMember: {
    en: "You're not a member yet. Reply JOIN to sign up!",
    zhHk: '您尚未成為會員。回覆 JOIN 就可以加入！',
  },
  balance: {
    en: ({ points }) =>
      `Your balance: ${points} points. Send a receipt photo to earn more!`,
    zhHk: ({ points }) =>
      `您目前有 ${points} 積分。傳送收據相片就可以賺取更多！`,
  },
  unsubscribed: {
    en: "You've been unsubscribed. Reply JOIN anytime to re-join.",
    zhHk: '您已取消訂閱。隨時回覆 JOIN 重新加入。',
  },
  rewardsEmpty: {
    en: 'No rewards available yet. Stay tuned!',
    zhHk: '暫未有獎賞，請密切留意！',
  },
  rewardsHeader: {
    en: ({ points }) => `🎁 You have ${points} points! Choose a reward:`,
    zhHk: ({ points }) => `🎁 您有 ${points} 積分！請選擇獎賞：`,
  },
  cantAfford: {
    en: ({ points, name, cost }) =>
      `You have ${points} points. Keep earning to unlock rewards! Next reward: ${name} (${cost} pts)`,
    zhHk: ({ points, name, cost }) =>
      `您有 ${points} 積分。繼續賺取就可以解鎖獎賞！下一個獎賞：${name}（${cost} 積分）`,
  },
  receiptAck: {
    en: 'Got your receipt! Scanning now... this takes about 10 seconds.',
    zhHk: '已收到您的收據！正在掃描中…約需 10 秒。',
  },
  receiptImageMissing: {
    en: 'Sorry, I could not retrieve that image. Please try again.',
    zhHk: '抱歉，無法取得該相片，請再試一次。',
  },
  buttonPoints: { en: 'Check Points', zhHk: '查詢積分' },
  buttonRewards: { en: 'View Rewards', zhHk: '查看獎賞' },
  buttonHelp: { en: 'Help', zhHk: '幫助' },
  rewardButton: {
    en: ({ name, cost }) => `${name} (${cost}pts)`,
    zhHk: ({ name, cost }) => `${name} (${cost} 積分)`,
  },
  campaignUnavailable: {
    en: "Sorry, this promotion isn't available right now.",
    zhHk: '抱歉，此優惠目前未能使用。',
  },
  claimReady: {
    en: ({ code }) =>
      `Here's your coupon! Show this QR code to redeem. Code: ${code}`,
    zhHk: ({ code }) => `這是您的優惠券！出示此 QR 碼即可兌換。代碼：${code}`,
  },
}

// Overload: keys with no vars don't require the vars argument.
export function getSystemReply<K extends ReplyKey>(
  key: K,
  language: Language,
  ...vars: ReplyVarsMap[K] extends void ? [] : [ReplyVarsMap[K]]
): string
export function getSystemReply(
  key: ReplyKey,
  language: Language,
  vars?: unknown
): string {
  const entry = REPLIES[key]
  const template = language.equals(Language.EN) ? entry.en : entry.zhHk
  return typeof template === 'function'
    ? (template as (v: unknown) => string)(vars)
    : template
}
