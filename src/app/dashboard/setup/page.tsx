import { getTranslations } from 'next-intl/server'
import { QrGenerator } from '@/components/dashboard/qr-generator'
import { WelcomeSetupForm } from '@/components/dashboard/welcome-setup-form'
import { ReceiptTemplateSection } from '@/components/dashboard/receipt-template-section'
import { FlaggedReceiptsPanel } from '@/components/dashboard/flagged-receipts-panel'
import { TenantLogoSection } from '@/components/dashboard/tenant-logo-section'
import { ContactRedirectSection } from '@/components/dashboard/contact-redirect-section'
import { FallbackReplySection } from '@/components/dashboard/fallback-reply-section'
import { Separator } from '@/components/ui/separator'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { resolveReplyConfig } from '@/domain/services/reply-config'
import { resolveContactConfig } from '@/domain/services/contact-config'

export default async function SetupPage() {
  const t = await getTranslations('qr')
  const rt = await getTranslations('receiptTemplate')
  const st = await getTranslations('settings')
  const { restaurantId } = await getTenantContext()
  const supabase = createServerSupabaseClient()
  const { data: restaurant, error: restaurantError } = await supabase
    .from('restaurants')
    .select('logo_url, redirect_number, redirect_label, reply_config, contact_config')
    .eq('id', restaurantId)
    .single()

  // Fail loudly rather than rendering the redirect/reply/contact-config forms
  // primed with defaults: a silent fallback here would let an unrelated Save
  // PATCH real tenant config (REPLY-001 redirect, REPLY-003 toggles,
  // REPLY-005 contact settings) away with defaults on every query error —
  // most likely a deploy landing ahead of migration 058_restaurant_contact_config.sql.
  if (restaurantError) {
    throw new Error(
      `Failed to load restaurant settings for ${restaurantId}: ${restaurantError.message}`
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{st('heading')}</h1>
        <p className="text-muted-foreground mt-1">{st('description')}</p>
      </div>
      <TenantLogoSection initialLogoUrl={restaurant?.logo_url ?? null} />

      <Separator />

      <ContactRedirectSection
        initialRedirectNumber={restaurant?.redirect_number ?? null}
        initialRedirectLabel={restaurant?.redirect_label ?? 'Contact us'}
        initialContactConfig={resolveContactConfig(restaurant?.contact_config)}
      />

      <Separator />

      <FallbackReplySection
        initialConfig={resolveReplyConfig(restaurant?.reply_config)}
      />

      <Separator />

      <div>
        <h2 className="text-xl font-semibold text-foreground">{t('heading')}</h2>
        <p className="text-muted-foreground mt-1">{t('description')}</p>
      </div>
      <WelcomeSetupForm />
      <QrGenerator />

      <Separator />

      <div>
        <h2 className="text-xl font-semibold text-foreground">{rt('heading')}</h2>
        <p className="text-muted-foreground mt-1">
          {rt('description')}
        </p>
      </div>
      <ReceiptTemplateSection />

      <Separator />

      <div>
        <h2 className="text-xl font-semibold text-foreground">{rt('flaggedHeading')}</h2>
        <p className="text-muted-foreground mt-1">
          {rt('flaggedDescription')}
        </p>
      </div>
      <FlaggedReceiptsPanel />
    </div>
  )
}
