'use client'

/** AGENT-001 W2: the AI agent conversation log (sidebar → AI agent; tenant admins only, R7). */
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { AgentLogState, AgentThreadList, AgentThreadPanel } from '@/components/dashboard/agent-conversation-log'
import { useAgentThread, useAgentThreads } from '@/hooks/use-agent-conversations'

export default function AgentLogPage() {
  const t = useTranslations('agentLog')
  const { threads, status, reload } = useAgentThreads()
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const thread = useAgentThread(selectedKey)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t('heading')}</h1>
        <p className="mt-1 text-muted-foreground">{t('description')}</p>
      </div>
      {status !== 'ready' ? (
        <AgentLogState status={status} onRetry={reload} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <AgentThreadList threads={threads} selectedKey={selectedKey} onSelect={setSelectedKey} />
          {threads.length > 0 ? <AgentThreadPanel detail={thread.detail} status={thread.status} /> : null}
        </div>
      )}
    </div>
  )
}
