import { describe, it, expect } from 'vitest'
import { resolveRoute } from '../route-resolver'

describe('resolveRoute', () => {
  describe('priority 1: image type', () => {
    it('image type → receipt-image regardless of text', () => {
      const r = resolveRoute('whatever', 'image')
      expect(r.route).toBe('receipt-image')
    })
    it('image type wins over JOIN text', () => {
      const r = resolveRoute('JOIN', 'image')
      expect(r.route).toBe('receipt-image')
    })
  })

  describe('priority 2: JOIN', () => {
    it('text "JOIN" → JOIN', () => {
      expect(resolveRoute('JOIN', 'text').route).toBe('JOIN')
    })
    it('text "JOIN-rest-abc" → JOIN', () => {
      expect(resolveRoute('JOIN-rest-abc', 'text').route).toBe('JOIN')
    })
    it('Chinese alias 加入 → JOIN', () => {
      expect(resolveRoute('加入', 'text').route).toBe('JOIN')
    })
    it('Chinese alias 入會 → JOIN', () => {
      expect(resolveRoute('入會', 'text').route).toBe('JOIN')
    })
    it('Chinese alias 註冊 → JOIN', () => {
      expect(resolveRoute('註冊', 'text').route).toBe('JOIN')
    })
    it('Chinese alias with surrounding whitespace → JOIN (trimmed match)', () => {
      expect(resolveRoute('  加入  ', 'text').route).toBe('JOIN')
    })
  })

  describe('priority 3: REWARD_<id>', () => {
    it('REWARD_xyz → REWARD_REDEEM', () => {
      const r = resolveRoute('REWARD_xyz', 'text')
      expect(r.route).toBe('REWARD_REDEEM')
    })
  })

  describe('priority 4: REDEEM <code> (with argument)', () => {
    it('REDEEM ABC123 → REDEEM_CODE', () => {
      const r = resolveRoute('REDEEM ABC123', 'text')
      expect(r.route).toBe('REDEEM_CODE')
      expect(r.argument).toBe('ABC123')
    })
    it('redeem abc123 (lower) → REDEEM_CODE with upper arg', () => {
      const r = resolveRoute('redeem abc123', 'text')
      expect(r.route).toBe('REDEEM_CODE')
      expect(r.argument).toBe('ABC123')
    })
    it('兌換 ABC123 (Chinese) → REDEEM_CODE with trimmed arg', () => {
      const r = resolveRoute('兌換 ABC123', 'text')
      expect(r.route).toBe('REDEEM_CODE')
      expect(r.argument).toBe('ABC123')
    })
    it('兌換  ABC123 (Chinese, double space) → REDEEM_CODE', () => {
      const r = resolveRoute('兌換  ABC123', 'text')
      expect(r.route).toBe('REDEEM_CODE')
      expect(r.argument).toBe('ABC123')
    })
    it('"兌換 " (Chinese, trailing space, no arg) → falls through to REWARDS', () => {
      // Bare 兌換 with only trailing whitespace must not be treated as a
      // REDEEM_CODE with empty argument. It should fall through to matchCommand
      // which maps 兌換 → REDEEM (REWARDS list).
      const r = resolveRoute('兌換 ', 'text')
      expect(r.route).toBe('REDEEM')
    })
  })

  describe('priority 5: command keyword', () => {
    it('POINTS → POINTS', () => {
      expect(resolveRoute('POINTS', 'text').route).toBe('POINTS')
    })
    it('積分 → POINTS', () => {
      expect(resolveRoute('積分', 'text').route).toBe('POINTS')
    })
    it('HELP → HELP', () => {
      expect(resolveRoute('HELP', 'text').route).toBe('HELP')
    })
    it('幫助 → HELP', () => {
      expect(resolveRoute('幫助', 'text').route).toBe('HELP')
    })
    it('STOP → STOP', () => {
      expect(resolveRoute('STOP', 'text').route).toBe('STOP')
    })
    it('退訂 → STOP', () => {
      expect(resolveRoute('退訂', 'text').route).toBe('STOP')
    })
    it('YES → YES', () => {
      expect(resolveRoute('YES', 'text').route).toBe('YES')
    })
    it('是 → YES', () => {
      expect(resolveRoute('是', 'text').route).toBe('YES')
    })
    it('NO → NO', () => {
      expect(resolveRoute('NO', 'text').route).toBe('NO')
    })
    it('否 → NO', () => {
      expect(resolveRoute('否', 'text').route).toBe('NO')
    })
    it('REWARDS → REWARDS', () => {
      expect(resolveRoute('REWARDS', 'text').route).toBe('REWARDS')
    })
    it('REWARD (singular) → REWARDS (regression: pre-ONBOARD-007 behavior)', () => {
      // Users commonly type the singular "REWARD". Preserve that route so
      // the bilingual keyword switch does not silently break the existing UX.
      expect(resolveRoute('REWARD', 'text').route).toBe('REWARDS')
    })
    it('獎賞 → REWARDS', () => {
      expect(resolveRoute('獎賞', 'text').route).toBe('REWARDS')
    })
    it('兌換項目 → REWARDS (disambiguation)', () => {
      expect(resolveRoute('兌換項目', 'text').route).toBe('REWARDS')
    })
    it('bare REDEEM → REDEEM', () => {
      expect(resolveRoute('REDEEM', 'text').route).toBe('REDEEM')
    })
    it('bare 兌換 → REDEEM', () => {
      expect(resolveRoute('兌換', 'text').route).toBe('REDEEM')
    })
    it('CARD → MY_CARD (auto-routes via matchCommand, no resolver branch)', () => {
      expect(resolveRoute('CARD', 'text').route).toBe('MY_CARD')
    })
    it('QR → MY_CARD', () => {
      expect(resolveRoute('QR', 'text').route).toBe('MY_CARD')
    })
    it('我的會員碼 → MY_CARD', () => {
      expect(resolveRoute('我的會員碼', 'text').route).toBe('MY_CARD')
    })
  })

  describe('priority 6: unknown', () => {
    it('random text → unknown', () => {
      expect(resolveRoute('hello', 'text').route).toBe('unknown')
    })
    it('empty text → unknown', () => {
      expect(resolveRoute('', 'text').route).toBe('unknown')
    })
  })

  describe('interaction: REDEEM with whitespace arg still has priority over bare REDEEM', () => {
    it('"REDEEM   code" → REDEEM_CODE', () => {
      const r = resolveRoute('REDEEM   code', 'text')
      expect(r.route).toBe('REDEEM_CODE')
      expect(r.argument).toBe('CODE')
    })
  })
})
