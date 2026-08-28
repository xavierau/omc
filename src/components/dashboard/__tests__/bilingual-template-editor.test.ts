import { describe, it, expect } from 'vitest'
import {
  insertIntoActiveTab,
  isTabWarning,
  type BilingualValue,
  type TabKey,
} from '@/components/dashboard/bilingual-template-editor-helpers'

const empty: BilingualValue = { en: '', zhHk: '' }

describe('bilingual-template-editor helpers', () => {
  describe('insertIntoActiveTab', () => {
    it('inserts into EN when active tab is en', () => {
      const result = insertIntoActiveTab(empty, 'en', 0, '{{greeting}}')
      expect(result).not.toBeNull()
      expect(result!.value).toEqual({ en: '{{greeting}}', zhHk: '' })
      expect(result!.cursor).toBe('{{greeting}}'.length)
    })

    it('inserts into zh-HK when active tab is zhHk', () => {
      const value: BilingualValue = { en: 'english', zhHk: '你好' }
      const result = insertIntoActiveTab(value, 'zhHk', 2, '{{points}}')
      expect(result!.value).toEqual({ en: 'english', zhHk: '你好{{points}}' })
    })

    it('does not touch the inactive tab', () => {
      const value: BilingualValue = { en: 'hello', zhHk: '你好' }
      const result = insertIntoActiveTab(value, 'en', 5, 'X')
      expect(result!.value.zhHk).toBe('你好')
    })

    it('clamps cursor to the active tab length', () => {
      const value: BilingualValue = { en: 'hi', zhHk: '' }
      const result = insertIntoActiveTab(value, 'en', 99, 'X')
      expect(result!.value.en).toBe('hiX')
      expect(result!.cursor).toBe(3)
    })

    it('rejects when the resulting active tab would exceed maxLength', () => {
      const value: BilingualValue = { en: 'a'.repeat(1020), zhHk: '' }
      const result = insertIntoActiveTab(value, 'en', 1020, '{{greeting}}', 1024)
      expect(result).toBeNull()
    })

    it('allows insertion that stays within maxLength', () => {
      const value: BilingualValue = { en: 'a'.repeat(10), zhHk: '' }
      const result = insertIntoActiveTab(value, 'en', 10, 'XY', 1024)
      expect(result?.value.en).toBe('a'.repeat(10) + 'XY')
    })
  })

  describe('isTabWarning', () => {
    it('returns false when below 90% of maxLength', () => {
      expect(isTabWarning(100, 1024)).toBe(false)
      expect(isTabWarning(900, 1024)).toBe(false)
    })

    it('returns true when strictly above 90% of maxLength', () => {
      expect(isTabWarning(922, 1024)).toBe(true)
      expect(isTabWarning(1024, 1024)).toBe(true)
    })

    it('returns false at the exact 90% boundary', () => {
      expect(isTabWarning(Math.floor(1024 * 0.9), 1024)).toBe(false)
    })
  })

  describe('type guards', () => {
    it('TabKey accepts en and zhHk', () => {
      const tabs: TabKey[] = ['en', 'zhHk']
      expect(tabs).toHaveLength(2)
    })
  })
})
