'use client'

// INT-001 WI-9 — pure header block for the integration detail page (name,
// status badge, provider, back link). Extracted out of
// `app/dashboard/integrations/[id]/page.tsx` (which owns `useIntegrationDetail`
// and `use(params)`, real hooks this repo's jsdom-free test setup can't
// render) so the name/status rendering — including T-M9's escaped-rendering
// requirement — is unit-testable via a plain function call.

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import type { PublicIntegration } from '@/hooks/integrations-client'

export interface IntegrationDetailHeaderProps {
  integration: Pick<PublicIntegration, 'name' | 'status' | 'provider'>
}

/** Pure/props-driven. */
export function IntegrationDetailHeader({ integration }: IntegrationDetailHeaderProps) {
  const t = useTranslations('integrations')
  const tc = useTranslations('common')

  return (
    <div>
      <Link href="/dashboard/integrations" className="text-sm text-muted-foreground hover:text-foreground">
        {t('backToList')}
      </Link>
      <div className="flex items-center gap-3 mt-2">
        <h1 className="text-2xl font-semibold text-foreground" data-testid="integration-detail-name">
          {integration.name}
        </h1>
        <Badge variant={integration.status === 'active' ? 'default' : 'secondary'} data-testid="integration-detail-status">
          {integration.status === 'active' ? tc('active') : tc('inactive')}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground mt-1" data-testid="integration-detail-provider">
        {integration.provider}
      </p>
    </div>
  )
}
