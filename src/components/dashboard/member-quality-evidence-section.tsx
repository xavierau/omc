'use client'

import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { MemberQualityBadge } from './member-quality-badge'
import {
  buildQualityVerdict,
  isPmmThrottled,
  formatDate,
} from './member-detail-helpers'
import type { MemberQualityEvidence } from '@/infrastructure/supabase/repositories/member-quality-evidence'

type Translate = ReturnType<typeof useTranslations<'members'>>
type Message = MemberQualityEvidence['recentMessages'][number]

const STATUS_KEY: Record<string, string> = {
  queued: 'qualityMsgStatusQueued',
  sent: 'qualityMsgStatusSent',
  delivered: 'qualityMsgStatusDelivered',
  read: 'qualityMsgStatusRead',
  failed: 'qualityMsgStatusFailed',
}

function Counts({ counts, t }: { counts: MemberQualityEvidence['counts']; t: Translate }) {
  const items = [
    ['qualityCountDelivered', counts.delivered],
    ['qualityCountRead', counts.read],
    ['qualityCountFailed', counts.failed],
    ['qualityCountPending', counts.pending],
  ] as const
  return (
    <div className="grid grid-cols-4 gap-2 text-sm">
      {items.map(([key, n]) => (
        <div key={key}>
          <p className="text-muted-foreground">{t(key)}</p>
          <p className="font-medium">{n}</p>
        </div>
      ))}
    </div>
  )
}

function MessageRow({ m, t }: { m: Message; t: Translate }) {
  const failed = m.status === 'failed'
  const statusKey = STATUS_KEY[m.status]
  return (
    <li
      data-testid={`member-quality-message-${m.id}`}
      className={`flex items-start justify-between gap-2 rounded px-2 py-1 text-sm ${failed ? 'bg-red-500/10' : ''}`}
    >
      <div className="min-w-0">
        <p className="truncate">
          <span className="text-muted-foreground mr-2">{formatDate(m.queuedAt)}</span>
          {m.templateName ?? m.category}
        </p>
        {failed && m.errorCode && (
          <p className="text-xs text-red-700 dark:text-red-300">
            {m.errorCode}{m.errorTitle ? ` — ${m.errorTitle}` : ''}
          </p>
        )}
      </div>
      <Badge variant={failed ? 'destructive' : 'secondary'}>{statusKey ? t(statusKey as never) : m.status}</Badge>
    </li>
  )
}

function Flags({ e, t }: { e: MemberQualityEvidence; t: Translate }) {
  return (
    <>
      {e.unreachableAt && (
        <p className="text-sm text-red-700 dark:text-red-300">{t('qualityFlagUnreachable', { date: formatDate(e.unreachableAt) })}</p>
      )}
      {isPmmThrottled(e.pmmThrottledUntil) && e.pmmThrottledUntil && (
        <p className="text-sm text-yellow-700 dark:text-yellow-300">{t('qualityFlagThrottled', { date: formatDate(e.pmmThrottledUntil) })}</p>
      )}
    </>
  )
}

export function MemberQualityEvidenceSection({ memberId, evidence }: { memberId: string; evidence: MemberQualityEvidence | null }) {
  const t = useTranslations('members')
  if (!evidence) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="member-quality-evidence-unavailable">
        {t('qualityEvidenceUnavailable')}
      </p>
    )
  }
  const verdict = buildQualityVerdict(evidence, formatDate)
  return (
    <div className="space-y-3" data-testid="member-quality-evidence">
      <h3 className="text-sm font-semibold">{t('qualityEvidenceTitle')}</h3>
      <div className="flex items-start gap-2">
        <MemberQualityBadge memberId={memberId} quality={evidence.quality} testId="member-quality-evidence-badge" />
        <p className="text-sm" data-testid="member-quality-verdict">{t(verdict.key as never, verdict.values as never)}</p>
      </div>
      <Counts counts={evidence.counts} t={t} />
      <Flags e={evidence} t={t} />
      <h4 className="text-xs font-semibold text-muted-foreground">{t('qualityRecentMessages')}</h4>
      {evidence.recentMessages.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('qualityNoRecentMessages')}</p>
      ) : (
        <ul className="space-y-1">
          {evidence.recentMessages.map((m) => <MessageRow key={m.id} m={m} t={t} />)}
        </ul>
      )}
    </div>
  )
}
