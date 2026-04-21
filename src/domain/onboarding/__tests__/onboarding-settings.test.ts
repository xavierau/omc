import { describe, it, expect } from 'vitest'
import {
  computePatch,
  isDirty,
  insertAtCursor,
  MAX_TEMPLATE_LENGTH,
  CHAR_WARN_THRESHOLD,
  shouldWarnCharCount,
} from '@/domain/onboarding/onboarding-settings'
import type { OnboardingSettings } from '@/domain/onboarding/onboarding-settings'

const baseline: OnboardingSettings = {
  welcomeCampaignId: null,
  returningMemberTemplate: null,
}

describe('onboarding-settings domain', () => {
  describe('isDirty', () => {
    it('returns false when draft matches settings', () => {
      expect(isDirty(baseline, { welcomeCampaignId: '', returningMemberTemplate: '' })).toBe(false)
    })

    it('returns true when welcomeCampaignId changed', () => {
      expect(isDirty(baseline, { welcomeCampaignId: 'uuid-1', returningMemberTemplate: '' })).toBe(true)
    })

    it('returns true when returningMemberTemplate changed', () => {
      expect(isDirty(baseline, { welcomeCampaignId: '', returningMemberTemplate: 'hi' })).toBe(true)
    })

    it('treats empty string as null-equivalent for template', () => {
      const settings: OnboardingSettings = { welcomeCampaignId: null, returningMemberTemplate: null }
      expect(isDirty(settings, { welcomeCampaignId: '', returningMemberTemplate: '' })).toBe(false)
    })

    it('treats whitespace-only template as null-equivalent', () => {
      const settings: OnboardingSettings = { welcomeCampaignId: null, returningMemberTemplate: null }
      expect(isDirty(settings, { welcomeCampaignId: '', returningMemberTemplate: '   ' })).toBe(false)
    })
  })

  describe('computePatch', () => {
    it('returns empty object when nothing changed', () => {
      expect(computePatch(baseline, { welcomeCampaignId: '', returningMemberTemplate: '' })).toEqual({})
    })

    it('includes only changed campaign id', () => {
      expect(
        computePatch(baseline, { welcomeCampaignId: 'uuid-1', returningMemberTemplate: '' }),
      ).toEqual({ welcomeCampaignId: 'uuid-1' })
    })

    it('includes only changed template', () => {
      expect(
        computePatch(baseline, { welcomeCampaignId: '', returningMemberTemplate: 'hello' }),
      ).toEqual({ returningMemberTemplate: 'hello' })
    })

    it('converts empty string draft values to null in patch', () => {
      const settings: OnboardingSettings = {
        welcomeCampaignId: 'uuid-1',
        returningMemberTemplate: 'hi',
      }
      expect(
        computePatch(settings, { welcomeCampaignId: '', returningMemberTemplate: '' }),
      ).toEqual({ welcomeCampaignId: null, returningMemberTemplate: null })
    })

    it('includes both when both changed', () => {
      expect(
        computePatch(baseline, { welcomeCampaignId: 'uuid-1', returningMemberTemplate: 'welcome' }),
      ).toEqual({ welcomeCampaignId: 'uuid-1', returningMemberTemplate: 'welcome' })
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

    it('exports a warn threshold greater than 900', () => {
      expect(CHAR_WARN_THRESHOLD).toBeGreaterThanOrEqual(900)
      expect(CHAR_WARN_THRESHOLD).toBeLessThan(MAX_TEMPLATE_LENGTH)
    })

    it('warns when count exceeds threshold', () => {
      expect(shouldWarnCharCount(CHAR_WARN_THRESHOLD)).toBe(false)
      expect(shouldWarnCharCount(CHAR_WARN_THRESHOLD + 1)).toBe(true)
      expect(shouldWarnCharCount(0)).toBe(false)
    })
  })
})
