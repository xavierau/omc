// CAMP-016: Settings is split into groups, one URL each (/dashboard/setup/<group>).
// The order and the admin-only flag are the UX spec's (2026-11-19).
import { Store, MessageCircle, CalendarCheck, Megaphone, QrCode, ReceiptText } from 'lucide-react'

export const SETTINGS_GROUP_IDS = ['profile', 'messages', 'bookings', 'campaigns', 'welcome', 'receipts'] as const
export type SettingsGroupId = (typeof SETTINGS_GROUP_IDS)[number]

export interface SettingsGroup {
  id: SettingsGroupId
  icon: React.ComponentType<{ className?: string }>
  /** Hidden from non-admins, as the booking and agent sections were before the split. */
  adminOnly?: boolean
  badge?: 'new' | 'flagged'
}

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  { id: 'profile', icon: Store },
  { id: 'messages', icon: MessageCircle },
  { id: 'bookings', icon: CalendarCheck, adminOnly: true },
  { id: 'campaigns', icon: Megaphone, badge: 'new' },
  { id: 'welcome', icon: QrCode },
  { id: 'receipts', icon: ReceiptText, badge: 'flagged' },
]

export const DEFAULT_SETTINGS_GROUP: SettingsGroupId = 'profile'

export function settingsGroupHref(id: SettingsGroupId): string {
  return `/dashboard/setup/${id}`
}

export function visibleSettingsGroups(role: string): SettingsGroup[] {
  return SETTINGS_GROUPS.filter((g) => !g.adminOnly || role === 'admin')
}

/** The group a URL segment names, if this role may open it. */
export function resolveSettingsGroup(segment: string, role: string): SettingsGroupId | null {
  const group = visibleSettingsGroups(role).find((g) => g.id === segment)
  return group ? group.id : null
}
