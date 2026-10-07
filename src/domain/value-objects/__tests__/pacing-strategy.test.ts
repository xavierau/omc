import { describe, it, expect } from 'vitest'
import {
  isInActiveHours,
  type PacingConfig,
} from '@/domain/value-objects/pacing-strategy'

function buildConfig(overrides: Partial<PacingConfig> = {}): PacingConfig {
  return {
    strategy: 'engagement_tier',
    probeChunkSize: 100,
    scaleChunkSize: 100,
    activeHoursStartLocal: '10:00:00',
    activeHoursEndLocal: '22:00:00',
    tenantTimezone: 'Asia/Hong_Kong',
    ...overrides,
  }
}

describe('isInActiveHours', () => {
  it('returns true at 11am Hong Kong local time', () => {
    // 2026-05-04 03:00 UTC = 11:00 Asia/Hong_Kong (UTC+8)
    const at = new Date('2026-05-04T03:00:00Z')
    expect(isInActiveHours(at, buildConfig())).toBe(true)
  })

  it('returns false at 2am Hong Kong local time', () => {
    // 2026-05-04 18:00 UTC = 02:00 Hong Kong next day
    const at = new Date('2026-05-04T18:00:00Z')
    expect(isInActiveHours(at, buildConfig())).toBe(false)
  })

  it('treats start boundary (10:00 local) as inclusive', () => {
    const at = new Date('2026-05-04T02:00:00Z') // 10:00 HK
    expect(isInActiveHours(at, buildConfig())).toBe(true)
  })

  it('treats end boundary (22:00 local) as exclusive', () => {
    const at = new Date('2026-05-04T14:00:00Z') // 22:00 HK
    expect(isInActiveHours(at, buildConfig())).toBe(false)
  })

  it('returns true at 21:59 HK (one minute before end)', () => {
    const at = new Date('2026-05-04T13:59:00Z') // 21:59 HK
    expect(isInActiveHours(at, buildConfig())).toBe(true)
  })

  it('honors a non-default timezone', () => {
    // 2026-05-04 03:00 UTC = 04:00 Europe/London (BST). Outside 10–22.
    const config = buildConfig({ tenantTimezone: 'Europe/London' })
    const at = new Date('2026-05-04T03:00:00Z')
    expect(isInActiveHours(at, config)).toBe(false)
  })

  it('honors a custom narrower window (12:00–14:00 local)', () => {
    const config = buildConfig({
      activeHoursStartLocal: '12:00:00',
      activeHoursEndLocal: '14:00:00',
    })
    const inside = new Date('2026-05-04T05:00:00Z') // 13:00 HK
    const before = new Date('2026-05-04T03:30:00Z') // 11:30 HK
    expect(isInActiveHours(inside, config)).toBe(true)
    expect(isInActiveHours(before, config)).toBe(false)
  })
})
