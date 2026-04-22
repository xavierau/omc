import { describe, it, expect } from 'vitest'
import { Language } from '@/domain/value-objects/language'
import {
  confirmTotalPrompt,
  receiptUnreadableMessage,
  receiptDuplicateMessage,
  receiptWrongMerchantMessage,
  receiptTamperedMessage,
  receiptProcessingErrorMessage,
  receiptCancelledMessage,
  rejectionMessage,
} from '../confirm-receipt-messages'

describe('confirm-receipt-messages', () => {
  describe('confirmTotalPrompt', () => {
    it('EN — "I read your total as $X" with YES prompt', () => {
      const text = confirmTotalPrompt(Language.EN, { total: 150 })
      expect(text).toContain('$150')
      expect(text).toContain('YES')
    })

    it('EN — uses .toFixed(0) formatting', () => {
      const text = confirmTotalPrompt(Language.EN, { total: 149.6 })
      expect(text).toContain('$150')
    })

    it('ZH — 讀取到的金額為 $X, includes YES', () => {
      const text = confirmTotalPrompt(Language.ZH_HK, { total: 150 })
      expect(text).toContain('$150')
      expect(text).toContain('YES')
      expect(text).toContain('金額')
    })
  })

  describe('receiptUnreadableMessage', () => {
    it('EN — mentions "couldn\'t read" and clearer photo', () => {
      const text = receiptUnreadableMessage(Language.EN)
      expect(text.toLowerCase()).toContain("couldn't read")
      expect(text.toLowerCase()).toContain('clearer')
    })

    it('ZH — 無法讀取 and 清晰', () => {
      const text = receiptUnreadableMessage(Language.ZH_HK)
      expect(text).toContain('無法讀取')
      expect(text).toContain('清晰')
    })
  })

  describe('receiptDuplicateMessage', () => {
    it('EN — "already been submitted"', () => {
      expect(receiptDuplicateMessage(Language.EN).toLowerCase()).toContain(
        'already been submitted'
      )
    })

    it('ZH — 已提交', () => {
      expect(receiptDuplicateMessage(Language.ZH_HK)).toContain('已提交')
    })
  })

  describe('receiptWrongMerchantMessage', () => {
    it('EN — mentions "not from" / our store', () => {
      const text = receiptWrongMerchantMessage(Language.EN).toLowerCase()
      expect(text).toMatch(/not from|doesn't appear/)
    })

    it('ZH — 非本店 or 此收據非', () => {
      expect(receiptWrongMerchantMessage(Language.ZH_HK)).toMatch(/非本店|非.*收據/)
    })
  })

  describe('receiptTamperedMessage', () => {
    it('EN — mentions "modified" and asks for original', () => {
      const text = receiptTamperedMessage(Language.EN).toLowerCase()
      expect(text).toContain('modified')
      expect(text).toContain('original')
    })

    it('ZH — 疑似經過修改 and 原件', () => {
      const text = receiptTamperedMessage(Language.ZH_HK)
      expect(text).toMatch(/修改/)
      expect(text).toContain('原件')
    })
  })

  describe('receiptCancelledMessage', () => {
    it('EN — "Receipt cancelled" and invites a new photo', () => {
      const text = receiptCancelledMessage(Language.EN)
      expect(text).toContain('Receipt cancelled')
      expect(text.toLowerCase()).toContain('new photo')
    })

    it('ZH — 已取消收據 and mentions 新相片', () => {
      const text = receiptCancelledMessage(Language.ZH_HK)
      expect(text).toContain('已取消收據')
      expect(text).toContain('新相片')
    })
  })

  describe('receiptProcessingErrorMessage', () => {
    it('EN — catch-all error (stays English per scope)', () => {
      const text = receiptProcessingErrorMessage(Language.EN)
      expect(text.toLowerCase()).toContain('error')
    })

    it('ZH — catch-all stays English per ONBOARD-008 scope lock', () => {
      const text = receiptProcessingErrorMessage(Language.ZH_HK)
      // Error/catch-all text stays English per scope lock.
      expect(text.toLowerCase()).toContain('error')
    })
  })

  describe('rejectionMessage', () => {
    it('tamper × EN — maps to tampered English message', () => {
      expect(rejectionMessage('tamper', Language.EN)).toBe(
        receiptTamperedMessage(Language.EN)
      )
    })

    it('tamper × ZH_HK — maps to tampered zh-HK message', () => {
      expect(rejectionMessage('tamper', Language.ZH_HK)).toBe(
        receiptTamperedMessage(Language.ZH_HK)
      )
    })

    it('duplicate × EN — maps to duplicate English message', () => {
      expect(rejectionMessage('duplicate', Language.EN)).toBe(
        receiptDuplicateMessage(Language.EN)
      )
    })

    it('duplicate × ZH_HK — maps to duplicate zh-HK message', () => {
      expect(rejectionMessage('duplicate', Language.ZH_HK)).toBe(
        receiptDuplicateMessage(Language.ZH_HK)
      )
    })

    it('wrong_merchant × EN — maps to wrong-merchant English message', () => {
      expect(rejectionMessage('wrong_merchant', Language.EN)).toBe(
        receiptWrongMerchantMessage(Language.EN)
      )
    })

    it('wrong_merchant × ZH_HK — maps to wrong-merchant zh-HK message', () => {
      expect(rejectionMessage('wrong_merchant', Language.ZH_HK)).toBe(
        receiptWrongMerchantMessage(Language.ZH_HK)
      )
    })
  })
})
