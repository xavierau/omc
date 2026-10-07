/**
 * Pure fixture builder for the default welcome campaign that every tenant
 * gets seeded on sign-up. The template strings are intentionally kept in
 * sync with `onboarding-defaults.ts` (which is the runtime fallback when
 * no welcome campaign is mapped), except placeholders use double-brace
 * syntax so the same strings work in the campaign renderer.
 *
 * Keep this file pure — no I/O, no infra imports — so tests can assert
 * the fixture shape verbatim.
 */

export interface DefaultWelcomeCampaignInput {
  restaurantId: string
}

export interface DefaultWelcomeCampaignFixture {
  restaurantId: string
  name: string
  type: 'welcome'
  status: 'active'
  templateEn: string
  templateZhHk: string
  couponConfig: {
    discountType: 'percentage'
    discountValue: number
    expiresInDays: number
  }
}

const TEMPLATE_EN =
  'Welcome to our loyalty program!\n\n' +
  "You've received a welcome gift!\n" +
  'Use code: {{couponCode}}\n\n' +
  'Reply POINTS to check balance, or send a receipt photo to earn points.'

const TEMPLATE_ZH_HK =
  '歡迎加入我們的會員計劃！\n\n' +
  '您已獲得歡迎禮物！\n' +
  '請使用代碼：{{couponCode}}\n\n' +
  '回覆 POINTS 查詢積分，或傳送收據相片賺取積分。'

export function buildDefaultWelcomeCampaign(
  input: DefaultWelcomeCampaignInput
): DefaultWelcomeCampaignFixture {
  return {
    restaurantId: input.restaurantId,
    name: 'Default Welcome Campaign',
    type: 'welcome',
    status: 'active',
    templateEn: TEMPLATE_EN,
    templateZhHk: TEMPLATE_ZH_HK,
    couponConfig: {
      discountType: 'percentage',
      discountValue: 10,
      expiresInDays: 30,
    },
  }
}
