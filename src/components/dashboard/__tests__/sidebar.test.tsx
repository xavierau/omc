import { describe, it, expect } from 'vitest'
import { bookingsNavFor, secondaryNavItems } from '@/components/dashboard/sidebar'

// INT-001 WI-9, Integration Map #17: sidebar entry -> /dashboard/integrations.
// `Sidebar` itself owns real `useState`/`usePathname` and can't be exercised
// via a plain function call in this repo's jsdom-free test setup (see
// `render-tree-test-utils.ts`'s header comment) — `secondaryNavItems` is
// extracted specifically so this wiring is still unit-testable.
describe('secondaryNavItems', () => {
  const t = (key: string) => `t:${key}`

  it('includes an Integrations entry pointing at /dashboard/integrations', () => {
    const items = secondaryNavItems(t)
    const entry = items.find((item) => item.href === '/dashboard/integrations')
    expect(entry).toBeDefined()
    expect(entry!.label).toBe('t:integrations')
  })

  it('keeps the existing Settings entry untouched', () => {
    const items = secondaryNavItems(t)
    expect(items.find((item) => item.href === '/dashboard/setup')).toBeDefined()
  })
})

// BOOK-013 S5 (AC-15): no Bookings entry while booking mode is off.
describe('bookingsNavFor', () => {
  const t = (key: string) => `t:${key}`
  it('hides Bookings in mode off and shows it otherwise (and while the mode is unknown)', () => {
    expect(bookingsNavFor(t, 'off')).toEqual([])
    for (const mode of ['simple', 'external', null]) expect(bookingsNavFor(t, mode).map((i) => i.href)).toEqual(['/dashboard/bookings'])
  })
})
