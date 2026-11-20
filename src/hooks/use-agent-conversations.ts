'use client'

/**
 * AGENT-001 W2: the agent conversation log (thread list + one open thread).
 * A 403 is its own state: the log is for tenant admins only (R7).
 */
import { useCallback, useEffect, useState } from 'react'
import { useTenant } from '@/hooks/use-tenant'
import type { AgentThreadMessage, AgentThreadSummary } from '@/domain/services/agent-conversation-log'

export type AgentLogStatus = 'loading' | 'ready' | 'forbidden' | 'error'

export interface AgentThreadDetail {
  thread: { key: string; maskedPhone: string }
  messages: AgentThreadMessage[]
}

export function agentLogStatus(status: number): AgentLogStatus {
  if (status === 200) return 'ready'
  if (status === 403) return 'forbidden'
  return 'error'
}

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  try {
    const res = await fetch(url)
    return { status: res.status, body: await res.json().catch(() => null) }
  } catch {
    return { status: 0, body: null }
  }
}

async function fetchThreads(): Promise<{ status: AgentLogStatus; threads: AgentThreadSummary[] }> {
  const res = await getJson('/api/dashboard/agent/conversations')
  const status = agentLogStatus(res.status)
  return { status, threads: status === 'ready' ? ((res.body as { threads?: AgentThreadSummary[] })?.threads ?? []) : [] }
}

export function useAgentThreads() {
  const { restaurantId } = useTenant()
  const [threads, setThreads] = useState<AgentThreadSummary[]>([])
  const [status, setStatus] = useState<AgentLogStatus>('loading')

  const apply = useCallback((result: { status: AgentLogStatus; threads: AgentThreadSummary[] }) => {
    setThreads(result.threads)
    setStatus(result.status)
  }, [])

  const reload = useCallback(async () => {
    setStatus('loading')
    apply(await fetchThreads())
  }, [apply])

  useEffect(() => {
    let active = true
    void fetchThreads().then((result) => {
      if (active) apply(result)
    })
    return () => {
      active = false
    }
  }, [apply, restaurantId])

  return { threads, status, reload }
}

type ThreadStatus = AgentLogStatus | 'not_found' | 'idle'

/** The open thread; a result for an older key reads as loading until the new one lands. */
export function useAgentThread(key: string | null): { detail: AgentThreadDetail | null; status: ThreadStatus } {
  const [result, setResult] = useState<{ key: string; detail: AgentThreadDetail | null; status: ThreadStatus } | null>(null)

  useEffect(() => {
    if (!key) return
    let active = true
    void getJson(`/api/dashboard/agent/conversations/${encodeURIComponent(key)}`).then((res) => {
      if (!active) return
      const status: ThreadStatus = res.status === 404 ? 'not_found' : agentLogStatus(res.status)
      setResult({ key, status, detail: status === 'ready' ? (res.body as AgentThreadDetail) : null })
    })
    return () => {
      active = false
    }
  }, [key])

  if (!key) return { detail: null, status: 'idle' }
  if (!result || result.key !== key) return { detail: null, status: 'loading' }
  return { detail: result.detail, status: result.status }
}
