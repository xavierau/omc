'use client'

// INT-001 WI-9 — Integrations list page body: rows link into the detail
// page (`/dashboard/integrations/[id]`), plus an admin-only inline create
// form (name only; `provider` defaults server-side to 'generic' per
// `configure-pos-integration.ts`'s `createIntegration`, an untouched
// pre-existing route — WI-9 makes NO API changes). Without this the detail
// page the plan's Files list names would be unreachable for a tenant with
// zero integrations (Surgical Changes: "wiring IS part of the ask").
//
// Split into a stateful container (`IntegrationList`, owns fetch/useState —
// mirrors `TagManager`'s own list+inline-create shape) and a pure
// `IntegrationListView` (props -> JSX only), since this repo has no
// jsdom/RTL and can only render-tree-test stateless components (see
// `contact-redirect-section.test.tsx`'s own documented limitation).

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/shared/empty-state'
import {
  fetchIntegrations,
  createIntegrationRequest,
  type PublicIntegration,
} from '@/hooks/integrations-client'

export interface IntegrationListViewProps {
  integrations: PublicIntegration[]
  isAdmin: boolean
  name: string
  onNameChange: (value: string) => void
  onCreate: () => void
  creating: boolean
  createError: string | null
}

/** Pure/props-driven: the admin-only create form + the row list. */
export function IntegrationListView({
  integrations,
  isAdmin,
  name,
  onNameChange,
  onCreate,
  creating,
  createError,
}: IntegrationListViewProps) {
  const t = useTranslations('integrations')
  const tc = useTranslations('common')

  return (
    <div className="space-y-4">
      {isAdmin && (
        <Card data-testid="integration-create-form">
          <CardContent className="flex items-end gap-3 pt-4">
            <div className="flex-1">
              <label className="text-sm font-medium text-foreground mb-1 block">
                {t('createNameLabel')}
              </label>
              <Input
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder={t('createNamePlaceholder')}
                data-testid="integration-create-name-input"
              />
            </div>
            <Button onClick={onCreate} disabled={creating} data-testid="integration-create-submit">
              {creating ? tc('creating') : tc('create')}
            </Button>
          </CardContent>
          {createError && (
            <p className="text-xs text-destructive px-6 pb-4" data-testid="integration-create-error">
              {createError}
            </p>
          )}
        </Card>
      )}
      {integrations.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border" data-testid="integration-rows">
          {integrations.map((integration) => (
            <li key={integration.id}>
              <Link
                href={`/dashboard/integrations/${integration.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
                data-testid={`integration-row-${integration.id}`}
              >
                <div>
                  <p className="text-sm font-medium text-foreground">{integration.name}</p>
                  <p className="text-xs text-muted-foreground">{integration.provider}</p>
                </div>
                <Badge variant={integration.status === 'active' ? 'default' : 'secondary'}>
                  {integration.status === 'active' ? tc('active') : tc('inactive')}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function IntegrationList({ isAdmin }: { isAdmin: boolean }) {
  const t = useTranslations('integrations')
  const tc = useTranslations('common')
  const [integrations, setIntegrations] = useState<PublicIntegration[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const applyListResult = useCallback((result: Awaited<ReturnType<typeof fetchIntegrations>>) => {
    if (result.ok) {
      setIntegrations(result.integrations)
      setLoadError(null)
    } else {
      setLoadError(result.error)
    }
    setIsLoading(false)
  }, [])

  // Mount fetch chains `.then()` directly off the imported fetch (no
  // synchronous setState reachable from the effect body) — `load` below
  // sets `isLoading(true)` synchronously, which is fine for a click
  // handler but not for a useEffect (react-hooks-compiler
  // `set-state-in-effect`; see use-integrations.ts's header comment).
  useEffect(() => {
    fetchIntegrations().then(applyListResult)
  }, [applyListResult])

  const load = useCallback(() => {
    setIsLoading(true)
    return fetchIntegrations().then(applyListResult)
  }, [applyListResult])

  const onCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setCreateError(t('createNameRequired'))
      return
    }
    setCreating(true)
    setCreateError(null)
    const result = await createIntegrationRequest(trimmed)
    setCreating(false)
    if (!result.ok) {
      setCreateError(t('createFailed'))
      return
    }
    setName('')
    await load()
  }

  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="integrations-loading">
        {tc('loading')}
      </p>
    )
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-muted-foreground">{t('loadFailed')}</p>
        <Button variant="outline" onClick={load} className="mt-4">{tc('retry')}</Button>
      </div>
    )
  }

  return (
    <IntegrationListView
      integrations={integrations}
      isAdmin={isAdmin}
      name={name}
      onNameChange={(value) => {
        setName(value)
        setCreateError(null)
      }}
      onCreate={onCreate}
      creating={creating}
      createError={createError}
    />
  )
}
