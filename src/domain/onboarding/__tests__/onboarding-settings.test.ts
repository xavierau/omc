import { describe, it, expect } from 'vitest'
import {
  computePatch,
  isDirty,
  insertAtCursor,
  MAX_TEMPLATE_LENGTH,
  CHAR_WARN_THRESHOLD,
  shouldWarnCharCount,
  toDraft,
  missingCampaignLanguages,
} from '@/domain/onboarding/onboarding-settings'
import type {
  OnboardingSettings,
  OnboardingDraft,
  CampaignLike,
} from '@/domain/onboarding/onboarding-settings'

const baseline: OnboardingSettings = {
  welcomeCampaignId: null,
  returningMemberTemplate: null,
  returningMemberTemplateEn: null,
  returningMemberTemplateZhHk: null,
  defaultLanguage: 'zh_hk',
}

function emptyDraft(): OnboardingDraft {
  return {
    welcomeCampaignId: '',
    returningMemberTemplateEn: '',
    returningMemberTemplateZhHk: '',
    defaultLanguage: 'zh_hk',
  }
}

describe('onboarding-settings domain', () => {
  describe('toDraft', () => {
    it('defaults bilingual fields and language when settings are blank', () => {
      expect(toDraft(baseline)).toEqual(emptyDraft())
    })

    it('preserves existing values and ignores the legacy template', () => {
      const settings: OnboardingSettings = {
        welcomeCampaignId: 'uuid-x',
        returningMemberTemplate: 'legacy-should-be-ignored',
        returningMemberTemplateEn: 'Hi',
        returningMemberTemplateZhHk: '你好',
        defaultLanguage: 'en',
      }
      expect(toDraft(settings)).toEqual({
        welcomeCampaignId: 'uuid-x',
        returningMemberTemplateEn: 'Hi',
        returningMemberTemplateZhHk: '你好',
        defaultLanguage: 'en',
      })
    })

    it('falls back to zh_hk when defaultLanguage is missing', () => {
      const settings = {
        ...baseline,
        defaultLanguage: undefined as unknown as 'en',
      }
      expect(toDraft(settings).defaultLanguage).toBe('zh_hk')
    })
  })

  describe('isDirty', () => {
    it('returns false when draft matches settings', () => {
      expect(isDirty(baseline, emptyDraft())).toBe(false)
    })

    it('returns true when welcomeCampaignId changed', () => {
      expect(
        isDirty(baseline, { ...emptyDraft(), welcomeCampaignId: 'uuid-1' })
      ).toBe(true)
    })

    it('returns true when EN template changed', () => {
      expect(
        isDirty(baseline, { ...emptyDraft(), returningMemberTemplateEn: 'hi' })
      ).toBe(true)
    })

    it('returns true when zh-HK template changed', () => {
      expect(
        isDirty(baseline, { ...emptyDraft(), returningMemberTemplateZhHk: '你好' })
      ).toBe(true)
    })

    it('returns true when defaultLanguage changed', () => {
      expect(
        isDirty(baseline, { ...emptyDraft(), defaultLanguage: 'en' })
      ).toBe(true)
    })

    it('treats whitespace-only bilingual drafts as null-equivalent', () => {
      expect(
        isDirty(baseline, {
          ...emptyDraft(),
          returningMemberTemplateEn: '   ',
          returningMemberTemplateZhHk: '\t',
        })
      ).toBe(false)
    })
  })

  describe('computePatch', () => {
    it('returns empty object when nothing changed', () => {
      expect(computePatch(baseline, emptyDraft())).toEqual({})
    })

    it('never emits the legacy returningMemberTemplate field', () => {
      const settings: OnboardingSettings = {
        ...baseline,
        returningMemberTemplate: 'old',
      }
      const patch = computePatch(settings, {
        ...emptyDraft(),
        returningMemberTemplateEn: 'new',
      })
      expect(patch).not.toHaveProperty('returningMemberTemplate')
      expect(patch).toEqual({ returningMemberTemplateEn: 'new' })
    })

    it('includes only changed campaign id', () => {
      expect(
        computePatch(baseline, { ...emptyDraft(), welcomeCampaignId: 'uuid-1' })
      ).toEqual({ welcomeCampaignId: 'uuid-1' })
    })

    it('includes only changed EN template', () => {
      expect(
        computePatch(baseline, { ...emptyDraft(), returningMemberTemplateEn: 'hello' })
      ).toEqual({ returningMemberTemplateEn: 'hello' })
    })

    it('includes only changed zh-HK template', () => {
      expect(
        computePatch(baseline, { ...emptyDraft(), returningMemberTemplateZhHk: '你好' })
      ).toEqual({ returningMemberTemplateZhHk: '你好' })
    })

    it('includes changed defaultLanguage', () => {
      expect(
        computePatch(baseline, { ...emptyDraft(), defaultLanguage: 'en' })
      ).toEqual({ defaultLanguage: 'en' })
    })

    it('converts empty string draft values to null in patch', () => {
      const settings: OnboardingSettings = {
        welcomeCampaignId: 'uuid-1',
        returningMemberTemplate: 'hi',
        returningMemberTemplateEn: 'hi',
        returningMemberTemplateZhHk: '你好',
        defaultLanguage: 'zh_hk',
      }
      expect(computePatch(settings, emptyDraft())).toEqual({
        welcomeCampaignId: null,
        returningMemberTemplateEn: null,
        returningMemberTemplateZhHk: null,
      })
    })

    it('includes multiple bilingual changes together', () => {
      expect(
        computePatch(baseline, {
          welcomeCampaignId: 'uuid-1',
          returningMemberTemplateEn: 'welcome',
          returningMemberTemplateZhHk: '歡迎',
          defaultLanguage: 'en',
        })
      ).toEqual({
        welcomeCampaignId: 'uuid-1',
        returningMemberTemplateEn: 'welcome',
        returningMemberTemplateZhHk: '歡迎',
        defaultLanguage: 'en',
      })
    })
  })

  describe('insertAtCursor', () => {
    it('inserts at cursor position', () => {
      const result = insertAtCursor('Hello  world', 6, '{greeting}')
      expect(result.value).toBe('Hello {greeting} world')
      expect(result.cursor).toBe(16)
    })

    it('appends when cursor is at end', () => {
      const result = insertAtCursor('Hi', 2, '{points}')
      expect(result.value).toBe('Hi{points}')
      expect(result.cursor).toBe(10)
    })

    it('prepends when cursor is at start', () => {
      const result = insertAtCursor('world', 0, '{greeting} ')
      expect(result.value).toBe('{greeting} world')
      expect(result.cursor).toBe(11)
    })

    it('clamps negative cursor to 0', () => {
      const result = insertAtCursor('abc', -5, 'X')
      expect(result.value).toBe('Xabc')
      expect(result.cursor).toBe(1)
    })

    it('clamps cursor beyond length to length', () => {
      const result = insertAtCursor('abc', 99, 'X')
      expect(result.value).toBe('abcX')
      expect(result.cursor).toBe(4)
    })
  })

  describe('character limits', () => {
    it('exports a max length of 1024', () => {
      expect(MAX_TEMPLATE_LENGTH).toBe(1024)
    })

    it('exports a warn threshold in the 900-1023 range', () => {
      expect(CHAR_WARN_THRESHOLD).toBeGreaterThanOrEqual(900)
      expect(CHAR_WARN_THRESHOLD).toBeLessThan(MAX_TEMPLATE_LENGTH)
    })

    it('warns only when count strictly exceeds threshold', () => {
      expect(shouldWarnCharCount(CHAR_WARN_THRESHOLD)).toBe(false)
      expect(shouldWarnCharCount(CHAR_WARN_THRESHOLD + 1)).toBe(true)
      expect(shouldWarnCharCount(0)).toBe(false)
    })
  })

  describe('missingCampaignLanguages', () => {
    it('returns [] when both translations are present', () => {
      const c: CampaignLike = { templateEn: 'hi', templateZhHk: '你好' }
      expect(missingCampaignLanguages(c)).toEqual([])
    })

    it('returns [en] when EN is missing', () => {
      const c: CampaignLike = { templateEn: '', templateZhHk: '你好' }
      expect(missingCampaignLanguages(c)).toEqual(['en'])
    })

    it('returns [zh_hk] when zh-HK is missing', () => {
      const c: CampaignLike = { templateEn: 'hi', templateZhHk: null }
      expect(missingCampaignLanguages(c)).toEqual(['zh_hk'])
    })

    it('returns both when both are missing', () => {
      const c: CampaignLike = { templateEn: null, templateZhHk: '' }
      expect(missingCampaignLanguages(c)).toEqual(['en', 'zh_hk'])
    })

    it('treats whitespace-only as missing', () => {
      const c: CampaignLike = { templateEn: '   ', templateZhHk: '\t\n' }
      expect(missingCampaignLanguages(c)).toEqual(['en', 'zh_hk'])
    })
  })
})
