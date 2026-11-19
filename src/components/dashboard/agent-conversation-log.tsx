'use client'

/**
 * AGENT-001 W2: the agent conversation log (sidebar → AI agent). Left: one
 * row per diner thread (masked phone, last activity, message count, latest
 * outcome). Right: the open thread, diner messages next to the agent's
 * draft or sent reply with its outcome, model, latency and tool names.
 * Diner and model text is rendered as plain text (React escapes it).
 */
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { AgentOutcome } from '@/domain/ports/agent-reply'
import type { AgentThreadMessage, AgentThreadSummary } from '@/domain/services/agent-conversation-log'
import type { AgentLogStatus, AgentThreadDetail } from '@/hooks/use-agent-conversations'

const OUTCOME_VARIANT: Record<AgentOutcome, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  sent: 'default',
  shadow_draft: 'secondary',
  fallback: 'outline',
  skipped: 'outline',
  rate_limited: 'outline',
  error: 'destructive',
}

export function formatLogTime(iso: string): string {
  return new Date(iso).toLocaleString('en-HK', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

export function OutcomeBadge({ outcome, testId }: { outcome: AgentOutcome; testId?: string }) {
  const t = useTranslations('agentLog')
  return <Badge variant={OUTCOME_VARIANT[outcome]} data-testid={testId}>{t(`outcome.${outcome}`)}</Badge>
}

export function AgentThreadList(props: {
  threads: AgentThreadSummary[]
  selectedKey: string | null
  onSelect: (key: string) => void
}) {
  const t = useTranslations('agentLog')
  if (props.threads.length === 0) {
    return (
      <div data-testid="agent-log-empty" className="rounded-md border border-dashed border-border p-6 text-center">
        <p className="text-sm font-medium">{t('emptyTitle')}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t('emptyHint')}</p>
      </div>
    )
  }
  return (
    <ul data-testid="agent-log-thread-list" className="space-y-2">
      {props.threads.map((thread) => (
        <li key={thread.key}>
          <button type="button" onClick={() => props.onSelect(thread.key)} data-testid={`agent-log-thread-row-${thread.key}`}
            aria-current={props.selectedKey === thread.key ? 'true' : undefined}
            className={cn(
              'w-full rounded-md border border-border px-3 py-2 text-left transition-colors hover:bg-muted',
              props.selectedKey === thread.key && 'border-primary bg-muted'
            )}>
            <span className="flex items-center justify-between gap-2">
              <span className="font-mono text-sm">{thread.maskedPhone}</span>
              {thread.latestOutcome ? <OutcomeBadge outcome={thread.latestOutcome} /> : null}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {t('threadMeta', { time: formatLogTime(thread.lastActivityAt), count: thread.messageCount })}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function ModelMeta({ message }: { message: AgentThreadMessage }) {
  const t = useTranslations('agentLog')
  const parts = [
    message.model,
    message.latencyMs !== null ? t('latency', { ms: message.latencyMs }) : null,
    message.toolCalls.length > 0 ? t('tools', { names: message.toolCalls.join(', ') }) : t('noTools'),
  ].filter((p): p is string => p !== null)
  return <p data-testid={`agent-log-message-${message.id}-meta`} className="text-xs text-muted-foreground">{parts.join(' · ')}</p>
}

function MessageRow({ message }: { message: AgentThreadMessage }) {
  const t = useTranslations('agentLog')
  const isUser = message.role === 'user'
  return (
    <li data-testid={`agent-log-message-${message.id}`} className={cn('flex', isUser ? 'justify-start' : 'justify-end')}>
      <div className={cn('max-w-[85%] space-y-1 rounded-lg px-3 py-2', isUser ? 'bg-muted' : 'border border-border bg-background')}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium">{isUser ? t('diner') : t('agent')}</span>
          {message.outcome ? <OutcomeBadge outcome={message.outcome} testId={`agent-log-outcome-${message.id}`} /> : null}
          <span className="text-xs text-muted-foreground">{formatLogTime(message.createdAt)}</span>
        </div>
        {message.text ? (
          <p className="whitespace-pre-wrap break-words text-sm">{message.text}</p>
        ) : (
          <p className="text-sm italic text-muted-foreground">{t('noText')}</p>
        )}
        {isUser ? null : <ModelMeta message={message} />}
      </div>
    </li>
  )
}

export function AgentThreadPanel({ detail, status }: { detail: AgentThreadDetail | null; status: AgentLogStatus | 'not_found' | 'idle' }) {
  const t = useTranslations('agentLog')
  let body: React.ReactNode
  if (status === 'idle') body = <p data-testid="agent-log-detail-idle" className="text-sm text-muted-foreground">{t('pickThread')}</p>
  else if (status === 'loading') body = <p data-testid="agent-log-detail-loading" className="text-sm text-muted-foreground">{t('loading')}</p>
  else if (status === 'not_found') body = <p data-testid="agent-log-detail-not-found" role="alert" className="text-sm text-muted-foreground">{t('threadGone')}</p>
  else if (status !== 'ready' || !detail) body = <p data-testid="agent-log-detail-error" role="alert" className="text-sm text-destructive">{t('couldntLoad')}</p>
  else {
    body = (
      <>
        <h2 className="mb-3 font-mono text-base font-semibold">{detail.thread.maskedPhone}</h2>
        <ul className="space-y-3">
          {detail.messages.map((m) => <MessageRow key={m.id} message={m} />)}
        </ul>
      </>
    )
  }
  return (
    <Card data-testid="agent-log-detail">
      <CardContent className="py-4">{body}</CardContent>
    </Card>
  )
}

export function AgentLogState({ status, onRetry }: { status: AgentLogStatus; onRetry: () => void }) {
  const t = useTranslations('agentLog')
  const tc = useTranslations('common')
  if (status === 'loading') return <p data-testid="agent-log-loading" className="text-sm text-muted-foreground">{t('loading')}</p>
  if (status === 'forbidden') return <p data-testid="agent-log-forbidden" role="alert" className="text-sm text-muted-foreground">{t('adminOnly')}</p>
  return (
    <div data-testid="agent-log-error" className="flex flex-col items-center gap-3 py-12">
      <p className="text-muted-foreground">{t('couldntLoad')}</p>
      <Button variant="outline" onClick={onRetry}>{tc('retry')}</Button>
    </div>
  )
}
