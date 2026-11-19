import { getTranslations } from 'next-intl/server'
import { QrGenerator } from '@/components/dashboard/qr-generator'
import { WelcomeSetupForm } from '@/components/dashboard/welcome-setup-form'
import { ReceiptTemplateSection } from '@/components/dashboard/receipt-template-section'
import { FlaggedReceiptsPanel } from '@/components/dashboard/flagged-receipts-panel'
import { TenantLogoSection } from '@/components/dashboard/tenant-logo-section'
import { ContactRedirectSection } from '@/components/dashboard/contact-redirect-section'
import { FallbackReplySection } from '@/components/dashboard/fallback-reply-section'
import { BookingSettingsSection } from '@/components/dashboard/booking-settings-section'
import { AgentSettingsSection } from '@/components/dashboard/agent-settings-section'
import { CampaignSettingsSection } from '@/components/dashboard/settings/campaign-settings-section'
import { Separator } from '@/components/ui/separator'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { resolveReplyConfig } from '@/domain/services/reply-config'
import { resolveContactConfig } from '@/domain/services/contact-config'
import { getBookingConfig } from '@/infrastructure/supabase/repositories/booking-config-repository'
import { getAgentSettings } from '@/infrastructure/supabase/repositories/agent-config-repository'

// CAMP-016: the sections that were stacked on /dashboard/setup, moved
// unchanged into their groups (each keeps its own Save).

interface GroupProps {
  restaurantId: string
}

async function loadRestaurant(restaurantId: string) {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('restaurants')
    .select('logo_url, redirect_number, redirect_label, reply_config, contact_config')
    .eq('id', restaurantId)
    .single()
  // Fail loudly rather than rendering the redirect/reply/contact-config forms
  // primed with defaults: a silent fallback here would let an unrelated Save
  // PATCH real tenant config (REPLY-001 redirect, REPLY-003 toggles,
  // REPLY-005 contact settings) away with defaults on every query error —
  // most likely a deploy landing ahead of migration 058_restaurant_contact_config.sql.
  if (error) {
    throw new Error(`Failed to load restaurant settings for ${restaurantId}: ${error.message}`)
  }
  return data
}

async function GroupTitle({ id }: { id: string }) {
  const t = await getTranslations('settingsGroups')
  return <h2 className="text-xl font-semibold text-foreground">{t(`${id}.label`)}</h2>
}

export async function ProfileGroup({ restaurantId }: GroupProps) {
  const restaurant = await loadRestaurant(restaurantId)
  return (
    <div className="space-y-6">
      <GroupTitle id="profile" />
      <TenantLogoSection initialLogoUrl={restaurant?.logo_url ?? null} />
    </div>
  )
}

export async function MessagesGroup({ restaurantId }: GroupProps) {
  const restaurant = await loadRestaurant(restaurantId)
  return (
    <div className="space-y-6">
      <GroupTitle id="messages" />
      <ContactRedirectSection
        initialRedirectNumber={restaurant?.redirect_number ?? null}
        initialRedirectLabel={restaurant?.redirect_label ?? 'Contact us'}
        initialContactConfig={resolveContactConfig(restaurant?.contact_config)}
      />
      <Separator />
      <FallbackReplySection initialConfig={resolveReplyConfig(restaurant?.reply_config)} />
    </div>
  )
}

/** Admin-only; the page refuses the group for other roles before this renders. */
export async function BookingsGroup({ restaurantId }: GroupProps) {
  return (
    <div className="space-y-6">
      <GroupTitle id="bookings" />
      <BookingSettingsSection initialConfig={await getBookingConfig(restaurantId)} />
      <Separator />
      {/* AGENT-001: a read error renders the section's error state, never a form primed with defaults. */}
      <AgentSettingsSection initial={await getAgentSettings(restaurantId).catch(() => null)} />
    </div>
  )
}

export async function CampaignsGroup() {
  return <CampaignSettingsSection />
}

export async function WelcomeGroup() {
  const t = await getTranslations('qr')
  return (
    <div className="space-y-6">
      <GroupTitle id="welcome" />
      <div>
        <h3 className="text-lg font-semibold text-foreground">{t('heading')}</h3>
        <p className="text-muted-foreground mt-1">{t('description')}</p>
      </div>
      <WelcomeSetupForm />
      <QrGenerator />
    </div>
  )
}

export async function ReceiptsGroup() {
  const rt = await getTranslations('receiptTemplate')
  return (
    <div className="space-y-6">
      <GroupTitle id="receipts" />
      <div>
        <h3 className="text-lg font-semibold text-foreground">{rt('heading')}</h3>
        <p className="text-muted-foreground mt-1">{rt('description')}</p>
      </div>
      <ReceiptTemplateSection />
      <Separator />
      <div>
        <h3 className="text-lg font-semibold text-foreground">{rt('flaggedHeading')}</h3>
        <p className="text-muted-foreground mt-1">{rt('flaggedDescription')}</p>
      </div>
      <FlaggedReceiptsPanel />
    </div>
  )
}
