import { notFound } from 'next/navigation'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { resolveSettingsGroup, type SettingsGroupId } from '@/components/dashboard/settings/settings-groups'
import {
  BookingsGroup,
  CampaignsGroup,
  MessagesGroup,
  ProfileGroup,
  ReceiptsGroup,
  WelcomeGroup,
} from './groups'

const GROUPS: Record<SettingsGroupId, (props: { restaurantId: string }) => Promise<React.ReactElement>> = {
  profile: ProfileGroup,
  messages: MessagesGroup,
  bookings: BookingsGroup,
  campaigns: CampaignsGroup,
  welcome: WelcomeGroup,
  receipts: ReceiptsGroup,
}

export default async function SettingsGroupPage({ params }: { params: Promise<{ group: string }> }) {
  const { group } = await params
  const { restaurantId, role } = await getTenantContext()
  // Bookings & AI agent stays admin-only (BOOK-001 R14, AGENT-001 R7); the APIs enforce it too.
  const id = resolveSettingsGroup(group, role)
  if (!id) notFound()
  const Group = GROUPS[id]
  return <Group restaurantId={restaurantId} />
}
