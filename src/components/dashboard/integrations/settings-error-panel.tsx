'use client'

// INT-001 WI-15 — shared rejected-state panel for any UI slot gated on the
// settings fetch (Settings-tab cards, Deliveries tab body, paused-banner
// slot). Reuses settings-error-messages.ts's code -> i18n-key mapping
// (generic fallback for an unrecognized/free-text code, e.g. the settings
// GET route's raw 500 body) and offers a Retry action, matching the shape
// of the existing base-integration error branch two lines up in
// `[id]/page.tsx`. `testId` is caller-supplied so the several instances that
// can be on-screen together (banner + Settings tab, or Deliveries tab) stay
// distinguishable in tests and to `ui-test-runner`.

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { settingsErrorMessageKey } from '@/components/dashboard/integrations/settings-error-messages'

export function SettingsErrorPanel({
  errorCode,
  onRetry,
  testId,
}: {
  errorCode: string
  onRetry: () => void
  testId: string
}) {
  const t = useTranslations('integrations')
  const tc = useTranslations('common')

  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-destructive/40 p-6 text-center"
      data-testid={testId}
    >
      <p className="text-sm text-muted-foreground">{t(settingsErrorMessageKey(errorCode))}</p>
      <Button variant="outline" size="sm" onClick={onRetry} data-testid={`${testId}-retry`}>
        {tc('retry')}
      </Button>
    </div>
  )
}
