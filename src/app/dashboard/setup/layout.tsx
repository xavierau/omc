import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { SettingsShell } from '@/components/dashboard/settings/settings-shell'

// CAMP-016: Settings is regrouped into one page per group, /dashboard/setup/<group>.
export default async function SetupLayout({ children }: { children: React.ReactNode }) {
  const { role } = await getTenantContext()
  return <SettingsShell role={role}>{children}</SettingsShell>
}
