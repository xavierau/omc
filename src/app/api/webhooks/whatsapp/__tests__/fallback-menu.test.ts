import { describe, it, expect } from 'vitest'
import {
  buildFallbackMenu,
  buildHelpText,
  MEMBER_OPTIONS_EN,
  MEMBER_OPTIONS_ZH,
  OPTIONS_BUTTON_EN,
  UNKNOWN_EN,
  type MenuOption,
} from '../fallback-menu'
import { DEFAULT_REPLY_FEATURES } from '@/domain/services/reply-config'

const CONTACT: MenuOption = { id: 'CONTACT', title: 'Contact us' }

describe('buildFallbackMenu', () => {
  it('returns kind:"buttons" for exactly 3 options (member, no Contact)', () => {
    const menu = buildFallbackMenu(UNKNOWN_EN, OPTIONS_BUTTON_EN, MEMBER_OPTIONS_EN)
    expect(menu.kind).toBe('buttons')
    if (menu.kind !== 'buttons') throw new Error('expected buttons')
    expect(menu.buttons).toEqual(MEMBER_OPTIONS_EN)
  })

  it('returns kind:"list" for 4 options with rows in order, Contact last', () => {
    const options = [...MEMBER_OPTIONS_EN, CONTACT]
    const menu = buildFallbackMenu(UNKNOWN_EN, OPTIONS_BUTTON_EN, options)
    expect(menu.kind).toBe('list')
    if (menu.kind !== 'list') throw new Error('expected list')
    expect(menu.bodyText).toBe(UNKNOWN_EN)
    expect(menu.buttonText).toBe(OPTIONS_BUTTON_EN)
    expect(menu.sections).toHaveLength(1)
    expect(menu.sections[0].title).toBeUndefined()
    expect(menu.sections[0].rows).toEqual([
      { id: 'POINTS', title: 'Check Points' },
      { id: 'REWARDS', title: 'View Rewards' },
      { id: 'HELP', title: 'Help' },
      { id: 'CONTACT', title: 'Contact us' },
    ])
  })

  it('returns kind:"buttons" for 2 options (non-member + Contact)', () => {
    const menu = buildFallbackMenu('body', OPTIONS_BUTTON_EN, [
      { id: 'JOIN', title: 'Join Rewards' },
      CONTACT,
    ])
    expect(menu.kind).toBe('buttons')
  })

  it('returns kind:"buttons" for a single option (non-member, no Contact)', () => {
    const menu = buildFallbackMenu('body', OPTIONS_BUTTON_EN, [
      { id: 'JOIN', title: 'Join Rewards' },
    ])
    expect(menu.kind).toBe('buttons')
    if (menu.kind !== 'buttons') throw new Error('expected buttons')
    expect(menu.buttons).toEqual([{ id: 'JOIN', title: 'Join Rewards' }])
  })

  it('preserves ZH member titles in a list', () => {
    const options = [...MEMBER_OPTIONS_ZH, CONTACT]
    const menu = buildFallbackMenu('body', OPTIONS_BUTTON_EN, options)
    if (menu.kind !== 'list') throw new Error('expected list')
    expect(menu.sections[0].rows[0]).toEqual({ id: 'POINTS', title: '查詢積分' })
  })
})

describe('buildHelpText (REPLY-003)', () => {
  const only = (...on: string[]) =>
    ({ points: false, rewards: false, redeem: false, card: false, ...Object.fromEntries(on.map((k) => [k, true])) }) as never

  it('lists every function line + STOP + LANG when all enabled (EN)', () => {
    const text = buildHelpText(true, DEFAULT_REPLY_FEATURES)
    expect(text).toBe(
      'Available commands:\n' +
        '• POINTS / 積分 — Check your balance\n' +
        '• REWARDS / 獎賞 — View rewards\n' +
        '• REDEEM <code> / 兌換 <代碼> — Use a coupon\n' +
        '• CARD / 我的會員碼 — Get your stamp-card QR\n' +
        '• STOP / 退訂 — Unsubscribe\n' +
        '• LANG EN / 語言 中文 — Change language'
    )
  })

  it('lists every function line + STOP + LANG when all enabled (ZH)', () => {
    const text = buildHelpText(false, DEFAULT_REPLY_FEATURES)
    expect(text).toBe(
      '可用指令：\n' +
        '• POINTS / 積分 — 查詢餘額\n' +
        '• REWARDS / 獎賞 — 查看獎賞\n' +
        '• REDEEM <代碼> / 兌換 <代碼> — 使用優惠券\n' +
        '• CARD / 我的會員碼 — 取得您的儲印花會員碼\n' +
        '• STOP / 退訂 — 停止接收訊息\n' +
        '• LANG EN / 語言 中文 — 切換語言'
    )
  })

  it('omits the line for each disabled function but always keeps STOP + LANG', () => {
    const text = buildHelpText(true, only('rewards'))
    expect(text).toContain('View rewards')
    expect(text).not.toContain('Check your balance')
    expect(text).not.toContain('Use a coupon')
    expect(text).not.toContain('stamp-card QR')
    expect(text).toContain('Unsubscribe')
    expect(text).toContain('Change language')
  })

  it('drops all function lines when every function is off (header + STOP + LANG only)', () => {
    const text = buildHelpText(true, only())
    expect(text).toBe(
      'Available commands:\n' +
        '• STOP / 退訂 — Unsubscribe\n' +
        '• LANG EN / 語言 中文 — Change language'
    )
  })

  // REPLY-004: `help` gates the menu button only — it contributes no command line
  // to the HELP body, whether on or off.
  it('the help feature adds no line to the HELP body', () => {
    const withHelp = buildHelpText(true, only('help'))
    const withoutHelp = buildHelpText(true, only())
    expect(withHelp).toBe(withoutHelp)
    expect(withHelp).not.toMatch(/help/i)
  })
})
