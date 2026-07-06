import { describe, it, expect } from 'vitest'
import {
  buildFallbackMenu,
  MEMBER_OPTIONS_EN,
  MEMBER_OPTIONS_ZH,
  OPTIONS_BUTTON_EN,
  UNKNOWN_EN,
  type MenuOption,
} from '../fallback-menu'

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
