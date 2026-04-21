import { describe, it, expect } from 'vitest'
import { matchCommand } from '@/domain/services/command-keywords'

describe('matchCommand', () => {
  describe('POINTS synonyms', () => {
    it('matches POINTS (upper)', () => {
      expect(matchCommand('POINTS')).toBe('POINTS')
    })
    it('matches points (lower)', () => {
      expect(matchCommand('points')).toBe('POINTS')
    })
    it('matches Points (mixed case)', () => {
      expect(matchCommand('Points')).toBe('POINTS')
    })
    it('matches 積分', () => {
      expect(matchCommand('積分')).toBe('POINTS')
    })
    it('matches 查積分', () => {
      expect(matchCommand('查積分')).toBe('POINTS')
    })
    it('matches 查詢積分', () => {
      expect(matchCommand('查詢積分')).toBe('POINTS')
    })
  })

  describe('HELP synonyms', () => {
    it('matches HELP', () => {
      expect(matchCommand('HELP')).toBe('HELP')
    })
    it('matches help (lower)', () => {
      expect(matchCommand('help')).toBe('HELP')
    })
    it('matches 幫助', () => {
      expect(matchCommand('幫助')).toBe('HELP')
    })
    it('matches 說明', () => {
      expect(matchCommand('說明')).toBe('HELP')
    })
  })

  describe('STOP synonyms', () => {
    it('matches STOP', () => {
      expect(matchCommand('STOP')).toBe('STOP')
    })
    it('matches 退訂', () => {
      expect(matchCommand('退訂')).toBe('STOP')
    })
    it('matches 停止', () => {
      expect(matchCommand('停止')).toBe('STOP')
    })
  })

  describe('YES synonyms', () => {
    it('matches YES', () => {
      expect(matchCommand('YES')).toBe('YES')
    })
    it('matches Y', () => {
      expect(matchCommand('Y')).toBe('YES')
    })
    it('matches y (lower)', () => {
      expect(matchCommand('y')).toBe('YES')
    })
    it('matches 是', () => {
      expect(matchCommand('是')).toBe('YES')
    })
    it('matches 確認', () => {
      expect(matchCommand('確認')).toBe('YES')
    })
    it('matches 確定', () => {
      expect(matchCommand('確定')).toBe('YES')
    })
  })

  describe('NO synonyms', () => {
    it('matches NO', () => {
      expect(matchCommand('NO')).toBe('NO')
    })
    it('matches N', () => {
      expect(matchCommand('N')).toBe('NO')
    })
    it('matches 否', () => {
      expect(matchCommand('否')).toBe('NO')
    })
    it('matches 取消', () => {
      expect(matchCommand('取消')).toBe('NO')
    })
  })

  describe('REWARDS synonyms', () => {
    it('matches REWARDS', () => {
      expect(matchCommand('REWARDS')).toBe('REWARDS')
    })
    it('matches REWARD (singular, regression: pre-ONBOARD-007 behavior)', () => {
      expect(matchCommand('REWARD')).toBe('REWARDS')
    })
    it('matches 獎賞', () => {
      expect(matchCommand('獎賞')).toBe('REWARDS')
    })
    it('matches 兌換項目 (disambiguates from 兌換 REDEEM)', () => {
      expect(matchCommand('兌換項目')).toBe('REWARDS')
    })
  })

  describe('REDEEM synonyms', () => {
    it('matches REDEEM', () => {
      expect(matchCommand('REDEEM')).toBe('REDEEM')
    })
    it('matches 兌換 (bare → REDEEM)', () => {
      expect(matchCommand('兌換')).toBe('REDEEM')
    })
  })

  describe('whitespace normalization', () => {
    it('trims leading/trailing whitespace', () => {
      expect(matchCommand('  POINTS  ')).toBe('POINTS')
    })
    it('trims and matches CJK after trim', () => {
      expect(matchCommand('  積分  ')).toBe('POINTS')
    })
    it('collapses internal whitespace for ASCII (but still must match exactly)', () => {
      // "POINTS " or "  POINTS" → POINTS. "POINT S" would collapse to "POINT S" which is NOT in list.
      expect(matchCommand('POINTS\t')).toBe('POINTS')
    })
  })

  describe('boundaries — no partial match', () => {
    it('POINT (singular) returns null', () => {
      expect(matchCommand('POINT')).toBeNull()
    })
    it('POINTS! with punctuation returns null', () => {
      expect(matchCommand('POINTS!')).toBeNull()
    })
    it('XPOINTS returns null', () => {
      expect(matchCommand('XPOINTS')).toBeNull()
    })
    it('POINTSX returns null', () => {
      expect(matchCommand('POINTSX')).toBeNull()
    })
    it('mixed HELP幫助 returns null (not ASCII-only, CJK kept as-is and not in list)', () => {
      expect(matchCommand('HELP幫助')).toBeNull()
    })
  })

  describe('empty / nullish input', () => {
    it('empty string returns null', () => {
      expect(matchCommand('')).toBeNull()
    })
    it('whitespace-only returns null', () => {
      expect(matchCommand('   ')).toBeNull()
    })
    it('null returns null', () => {
      expect(matchCommand(null)).toBeNull()
    })
    it('undefined returns null', () => {
      expect(matchCommand(undefined)).toBeNull()
    })
  })

  describe('unknown commands', () => {
    it('random English returns null', () => {
      expect(matchCommand('hello world')).toBeNull()
    })
    it('random CJK returns null', () => {
      expect(matchCommand('你好')).toBeNull()
    })
  })

  describe('CJK preservation (no uppercasing on CJK strings)', () => {
    it('CJK string is not uppercased (would break lookup)', () => {
      // Regression guard: if we accidentally called toUpperCase() on CJK,
      // the result would still equal the original (CJK has no case),
      // so this also asserts that matching does not rely on case conversion
      // for the CJK branch.
      expect(matchCommand('積分')).toBe('POINTS')
      expect(matchCommand('獎賞')).toBe('REWARDS')
    })
  })
})
