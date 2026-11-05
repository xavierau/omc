'use client'

import { useTranslations } from 'next-intl'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, CheckCircle2, XCircle, PartyPopper, CalendarClock, SearchX } from 'lucide-react'
import { StampPhoneLookup } from './stamp-phone-lookup'
import type { StampResult, StampOutcome } from '@/hooks/use-give-stamp'

interface StampResultCardProps {
  result: StampResult | null
  loading: boolean
  lookupLoading: boolean
  lookupNotFound: boolean
  onConfirm: () => void
  onGiveAnother: () => void
  onLookupByPhone: (phone: string) => void
  onAddMember: () => void
}

type T = ReturnType<typeof useTranslations>

const ICONS: Record<StampOutcome, typeof CheckCircle2> = {
  stamped: CheckCircle2,
  already_stamped_today: CalendarClock,
  completed: PartyPopper,
  no_active_campaign: XCircle,
  not_resolved: SearchX,
}

const SUCCESS_OUTCOMES: StampOutcome[] = ['stamped', 'completed']

function ConfirmScreen({ loading, onConfirm, t }: { loading: boolean; onConfirm: () => void; t: T }) {
  return (
    <Card data-outcome="confirm">
      <CardContent className="pt-6 text-center space-y-4">
        <p className="text-lg font-semibold">{t('stampConfirmTitle')}</p>
        <p className="text-sm text-muted-foreground">{t('stampConfirmHint')}</p>
        <Button className="w-full" size="lg" onClick={onConfirm} disabled={loading}>
          {loading ? <><Loader2 className="animate-spin mr-2" />{t('stamping')}</> : t('stampConfirmButton')}
        </Button>
      </CardContent>
    </Card>
  )
}

function ResultHeader({ result, t }: { result: StampResult; t: T }) {
  const Icon = ICONS[result.outcome]
  const success = SUCCESS_OUTCOMES.includes(result.outcome)
  return (
    <>
      <Icon className={`mx-auto size-12 ${success ? 'text-green-500' : 'text-muted-foreground'}`} />
      <ResultTitle result={result} t={t} />
    </>
  )
}

function ResultTitle({ result, t }: { result: StampResult; t: T }) {
  if (result.outcome === 'stamped') {
    return <ProgressTitle headingKey="stampAdded" result={result} t={t} />
  }
  if (result.outcome === 'already_stamped_today') {
    return <ProgressTitle headingKey="stampAlreadyToday" result={result} t={t} />
  }
  const map: Record<string, string> = {
    completed: 'stampCompleted',
    no_active_campaign: 'stampNoCampaign',
    not_resolved: 'stampNotResolved',
  }
  return <p className="text-lg font-semibold">{t(map[result.outcome])}</p>
}

function ProgressTitle({ headingKey, result, t }: { headingKey: string; result: StampResult; t: T }) {
  const remaining = Math.max(result.stampsRequired - result.stampsCount, 0)
  return (
    <div className="space-y-1">
      <p className="text-lg font-semibold">{t(headingKey)}</p>
      <p className="text-2xl font-bold tabular-nums">
        {t('stampProgress', { count: result.stampsCount, required: result.stampsRequired })}
      </p>
      {result.outcome === 'stamped' && remaining > 0 && (
        <p className="text-sm text-muted-foreground">{t('stampToGo', { remaining })}</p>
      )}
    </div>
  )
}

export function StampResultCard(props: StampResultCardProps) {
  const t = useTranslations('scan')
  const { result, loading, onConfirm, onGiveAnother } = props

  if (!result) return <ConfirmScreen loading={loading} onConfirm={onConfirm} t={t} />

  const borderClass = SUCCESS_OUTCOMES.includes(result.outcome) ? 'border-green-500' : ''
  return (
    <Card className={borderClass} data-outcome={result.outcome}>
      <CardContent className="pt-6 text-center space-y-4">
        <ResultHeader result={result} t={t} />
        {result.outcome === 'not_resolved' && (
          <StampPhoneLookup
            loading={props.lookupLoading}
            notFound={props.lookupNotFound}
            onLookup={props.onLookupByPhone}
            onAddMember={props.onAddMember}
          />
        )}
        <Button variant="outline" className="w-full" onClick={onGiveAnother}>
          {t('stampGiveAnother')}
        </Button>
      </CardContent>
    </Card>
  )
}
