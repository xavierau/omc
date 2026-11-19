import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { resolveSettingsGroup, settingsGroupHref, visibleSettingsGroups } from '@/components/dashboard/settings/settings-groups'
import { formFromSettings, formToBody, isDirty, skippedToday } from '@/components/dashboard/settings/campaign-settings-form'
import { qualityMeaningValues } from '@/components/dashboard/quality-meaning'
import { isNavItemActive } from '@/components/dashboard/sidebar'

describe('Settings groups (CAMP-016)', () => {
  it('admins see six groups in the spec order; staff do not see Bookings & AI agent', () => {
    expect(visibleSettingsGroups('admin').map((g) => g.id)).toEqual(['profile', 'messages', 'bookings', 'campaigns', 'welcome', 'receipts'])
    expect(visibleSettingsGroups('staff').map((g) => g.id)).toEqual(['profile', 'messages', 'campaigns', 'welcome', 'receipts'])
  })

  it('a staff member cannot open the bookings group by URL; unknown groups resolve to nothing', () => {
    expect(resolveSettingsGroup('bookings', 'staff')).toBeNull()
    expect(resolveSettingsGroup('bookings', 'admin')).toBe('bookings')
    expect(resolveSettingsGroup('nope', 'admin')).toBeNull()
  })

  // r3 F5: /dashboard/setup now opens Profile (desktop) or the index (phone),
  // so a link whose intent is the QR code must name the Welcome & QR group.
  it.each(['src/app/dashboard/members/page.tsx', 'src/app/dashboard/page.tsx'])(
    '%s links its QR action to the Welcome & QR group',
    (file) => {
      const src = readFileSync(join(process.cwd(), file), 'utf8')
      expect(src).toContain("settingsGroupHref('welcome')")
      expect(src).not.toMatch(/["'`]\/dashboard\/setup["'`]/)
      expect(settingsGroupHref('welcome')).toBe('/dashboard/setup/welcome')
    }
  )

  it('the sidebar Settings item stays active on a group URL, without widening other items', () => {
    expect(isNavItemActive('/dashboard/setup/campaigns', '/dashboard/setup')).toBe(true)
    expect(isNavItemActive('/dashboard/setup', '/dashboard/setup')).toBe(true)
    expect(isNavItemActive('/dashboard/campaigns/stamps', '/dashboard/campaigns')).toBe(false)
  })
})

describe('Settings → Campaigns form (CAMP-016)', () => {
  const saved = formFromSettings({ skipContactQuality: 'red', lapsedAfterDays: 30 })

  it('toggling skip off then on with the same level is not a change', () => {
    expect(isDirty({ ...saved, skipEnabled: false }, saved)).toBe(true)
    expect(isDirty({ ...saved }, saved)).toBe(false)
  })

  it('an out-of-range lapsed value has no body (Save disabled)', () => {
    expect(formToBody({ ...saved, lapsedDays: '0' })).toBeNull()
    expect(formToBody({ ...saved, lapsedDays: '366' })).toBeNull()
    expect(formToBody({ ...saved, skipEnabled: false, lapsedDays: '45' })).toEqual({ skipContactQuality: 'off', lapsedAfterDays: 45 })
  })

  it('the impact note counts red, or red + yellow', () => {
    const d = { total: 10, green: 5, yellow: 2, red: 1, noData: 2 }
    expect(skippedToday(d, 'red')).toBe(1)
    expect(skippedToday(d, 'red_yellow')).toBe(3)
  })

  it('meaning percentages come from the thresholds', () => {
    expect(qualityMeaningValues()).toEqual({ green: 90, yellow: 60, days: 90 })
  })

  // r3 F9: "60–89%" left 89.x% in no band; yellow runs up to UNDER green.
  const fill = (msg: string) =>
    msg.replace(/\{(\w+)\}/g, (_, k: string) => String((qualityMeaningValues() as unknown as Record<string, number>)[k]))
  const quality = (locale: string) =>
    (JSON.parse(readFileSync(join(process.cwd(), `src/messages/${locale}.json`), 'utf8')) as Record<string, Record<string, Record<string, string>>>).contactQuality

  it.each([
    ['en', '60% to under 90% delivered. Some messages fail.', '60% to under 90% delivered'],
    ['zh-HK', '60% 至低於 90% 送達，部分訊息失敗。', '60% 至低於 90% 送達'],
  ])('%s: the yellow band reads up to under the green threshold, with no gap', (locale, meaning, short) => {
    const q = quality(locale)
    expect(fill(q.meaning.yellow)).toBe(meaning)
    expect(fill(q.short.yellow)).toBe(short)
    for (const group of [q.meaning, q.short]) {
      for (const text of Object.values(group)) expect(fill(text)).not.toMatch(/89|undefined/)
    }
  })
})
