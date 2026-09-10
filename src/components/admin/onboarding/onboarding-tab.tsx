'use client'

import { useTranslations } from 'next-intl'
import { useAdminTenantOnboarding } from '@/hooks/use-admin-tenant-onboarding'
import { OnboardingPathSelector } from '@/components/admin/onboarding/onboarding-path-selector'
import { OnboardingPhaseIndicator } from '@/components/admin/onboarding/onboarding-phase-indicator'
import { ChecklistEditor } from '@/components/admin/onboarding/checklist-editor'
import { AdvancePhaseButton } from '@/components/admin/onboarding/advance-phase-button'
import { KpiGateSummary } from '@/components/admin/onboarding/kpi-gate-summary'

interface OnboardingTabProps {
  restaurantId: string
}

export function OnboardingTab({ restaurantId }: OnboardingTabProps) {
  const t = useTranslations('admin.onboarding')
  const tCommon = useTranslations('common')
  const { view, isLoading, error, setPath, updateChecklistItem, advancePhase } =
    useAdminTenantOnboarding(restaurantId)

  if (isLoading && !view) {
    return <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
  }
  if (error && !view) {
    return <p className="text-sm text-destructive">{error}</p>
  }
  if (!view) return null

  return (
    <section className="flex flex-col gap-6" data-onboarding-tab>
      <OnboardingPhaseIndicator view={view} />
      <div className="rounded-xl border bg-card p-4">
        <OnboardingPathSelector
          path={view.path}
          phase={view.phase}
          onChange={(path) => setPath(path)}
        />
      </div>
      <div className="rounded-xl border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium text-foreground">{t('checklist.title')}</h3>
        <ChecklistEditor
          checklist={view.checklist}
          onToggle={(key, checked) => updateChecklistItem(key, checked)}
        />
      </div>
      <div className="rounded-xl border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium text-foreground">{t('kpi.title')}</h3>
        <KpiGateSummary gate={view.kpiGate} />
      </div>
      <div className="flex items-center gap-3">
        <AdvancePhaseButton
          canAdvance={view.canAdvance}
          blockedReasons={view.blockedReasons}
          onAdvance={() => advancePhase()}
        />
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    </section>
  )
}
