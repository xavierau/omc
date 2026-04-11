import { describe, it, expect } from 'vitest'

// Extract and test the pure color logic from CampaignQuotaUsage
function usageColor(ratio: number): string {
  if (ratio >= 0.9) return 'bg-red-500'
  if (ratio >= 0.7) return 'bg-yellow-500'
  return 'bg-green-500'
}

function usageTextColor(ratio: number): string {
  if (ratio >= 0.9) return 'text-red-600'
  if (ratio >= 0.7) return 'text-yellow-600'
  return 'text-green-600'
}

describe('usageColor', () => {
  it('returns green when usage below 70%', () => {
    expect(usageColor(0)).toBe('bg-green-500')
    expect(usageColor(0.5)).toBe('bg-green-500')
    expect(usageColor(0.69)).toBe('bg-green-500')
  })

  it('returns yellow when usage is 70-89%', () => {
    expect(usageColor(0.7)).toBe('bg-yellow-500')
    expect(usageColor(0.8)).toBe('bg-yellow-500')
    expect(usageColor(0.89)).toBe('bg-yellow-500')
  })

  it('returns red when usage is 90%+', () => {
    expect(usageColor(0.9)).toBe('bg-red-500')
    expect(usageColor(0.95)).toBe('bg-red-500')
    expect(usageColor(1.0)).toBe('bg-red-500')
  })
})

describe('usageTextColor', () => {
  it('returns green text when usage below 70%', () => {
    expect(usageTextColor(0.5)).toBe('text-green-600')
  })

  it('returns yellow text when usage is 70-89%', () => {
    expect(usageTextColor(0.75)).toBe('text-yellow-600')
  })

  it('returns red text when usage is 90%+', () => {
    expect(usageTextColor(0.95)).toBe('text-red-600')
  })
})
