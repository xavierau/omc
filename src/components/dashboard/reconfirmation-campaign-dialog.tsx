'use client'

import { useReconfirmationDialogState } from './use-reconfirmation-dialog-state'
import { useTranslations } from 'next-intl'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useReconfirmationPreflight,
  type ReconfirmationPreflightResult,
} from '@/hooks/use-reconfirmation-preflight'
import { useReconfirmationCreate } from '@/hooks/use-reconfirmation-create'
import { formatViolation, isSubmitEnabled } from './reconfirmation-campaign-dialog-helpers'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (campaignId: string) => void
}

export function ReconfirmationCampaignDialog({ open, onOpenChange, onCreated }: Props) {
  const t = useTranslations('reconfirmation')
  const tc = useTranslations('common')
  const preflight = useReconfirmationPreflight()
  const create = useReconfirmationCreate()
  const { name, setName } = useReconfirmationDialogState()

  const allowed = preflight.data?.allowed ?? false
  const enabled = isSubmitEnabled({ allowed, isSubmitting: create.isSubmitting, name })

  async function handleSubmit() {
    if (!preflight.data) return
    const res = await create.submit({
      mode: 'reconfirmation',
      name: name.trim(),
      templateId: preflight.data.templatePreview?.id ?? '',
    })
    if (res?.campaignId) { onCreated(res.campaignId); onOpenChange(false) }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
        <SheetHeader><SheetTitle>{t('dialogTitle')}</SheetTitle></SheetHeader>
        <div className="px-4 pb-4 pt-2 space-y-4">
          <p className="text-sm text-muted-foreground">{t('explainer', { cap: preflight.data?.cap ?? 50 })}</p>
          {preflight.isLoading && (
            <p data-testid="reconfirmation-loading" className="text-sm text-muted-foreground">{tc('loading')}</p>
          )}
          {preflight.error && (
            <p data-testid="reconfirmation-error" className="text-sm text-destructive">{preflight.error}</p>
          )}
          {preflight.data && !allowed && renderViolations(preflight.data, t)}
          {preflight.data && allowed && renderAllowed(preflight.data, name, setName, t)}
          {create.error && <p className="text-sm text-destructive">{create.error}</p>}
          <div className="flex gap-2 pt-2">
            <Button data-testid="reconfirmation-submit" onClick={handleSubmit} disabled={!enabled}>
              {create.isSubmitting ? tc('creating') : t('submit')}
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>{tc('cancel')}</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

type T = (key: string, values?: Record<string, string | number>) => string

function renderViolations(data: ReconfirmationPreflightResult, t: T) {
  return (
    <ul className="space-y-1 text-sm text-destructive" data-testid="reconfirmation-violations">
      {data.violations.map((v) => {
        const { i18nKey, values } = formatViolation(v)
        return <li key={v.key} data-violation={v.key}>{t(i18nKey, values)}</li>
      })}
    </ul>
  )
}

function renderAllowed(data: ReconfirmationPreflightResult, name: string, setName: (v: string) => void, t: T) {
  const sample = data.audienceSample ?? []
  return (
    <div className="space-y-3">
      <p className="text-sm" data-testid="reconfirmation-audience-count">
        {t('preflightOk', { n: data.audienceCount })}
      </p>
      {data.templatePreview && (
        <div data-testid="reconfirmation-template-preview" className="rounded-md border bg-muted/30 p-3 text-sm">
          <p className="mb-1 text-xs font-medium text-muted-foreground">{t('templatePreviewTitle')}</p>
          <p className="font-mono text-xs">{data.templatePreview.bodyEn}</p>
          {data.templatePreview.bodyZhHk && <p className="font-mono text-xs">{data.templatePreview.bodyZhHk}</p>}
        </div>
      )}
      {sample.length > 0 && (
        <div data-testid="reconfirmation-audience-preview" className="text-sm">
          <p className="mb-1 text-xs text-muted-foreground">{t('audiencePreviewHelp', { n: sample.length })}</p>
          <ul className="space-y-1">
            {sample.map((row) => (
              <li key={row.phoneE164} data-audience-row={row.phoneE164} className="font-mono text-xs">
                {row.phoneE164} · {row.capturedAt.slice(0, 10)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Input
        data-testid="reconfirmation-name-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('dialogTitle')}
      />
    </div>
  )
}
