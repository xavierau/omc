'use client'

// INT-001 WI-9 — data hooks for the dashboard Integrations area. Mirrors
// `useAdminTenantDetail` (src/hooks/use-admin-tenant-detail.ts): GET-only,
// `refetch`/`mutate` re-runs the fetch; mutations live in the card
// components via `integrations-client.ts`, matching that file's own
// `onSaved={mutate}` convention. Not unit-tested directly (repo convention
// — see `use-admin-tenant-detail.ts`/`use-wa-templates.ts`, neither has a
// test file: real `useState`/`useEffect` can't be exercised without
// jsdom/RTL, which this repo intentionally doesn't have). The pure fetch
// functions these call (`integrations-client.ts`) carry the test coverage.
//
// The mount `useEffect` below deliberately does NOT call a `refetch`/
// `mutate` helper that sets state synchronously at its top (the shape
// `use-wa-templates.ts`/`use-admin-tenant-detail.ts` both use) — the
// react-hooks-compiler's `set-state-in-effect` rule flags that shape
// (verified empirically: it traces into a locally-closed function called
// from an effect, but not into an imported one). `refetch`/`mutate` still
// exist for retry buttons and post-mutation reloads, called only from
// event handlers, never from inside a `useEffect`; the mount effect below
// instead chains `.then()` on the raw imported fetch directly, matching
// `tag-manager.tsx`'s own lint-clean `fetchTags().then(setTags).finally(...)`
// shape. Trade-off, disclosed: navigating directly between two integration
// ids (not via the list) shows the previous id's data until the new fetch
// resolves, rather than an immediate loading flip — `isLoading` only ever
// resets to `true` on first mount (its initial value) or an explicit
// `mutate()` call, not on an `id` change alone.

import { useState, useEffect, useCallback } from 'react'
import { useTenant } from '@/hooks/use-tenant'
import {
  fetchIntegrations,
  fetchIntegrationDetail,
  fetchIntegrationSettings,
  isTenantAdmin,
  type PublicIntegration,
  type IntegrationSettingsView,
} from '@/hooks/integrations-client'

export function useIntegrationsList() {
  const [integrations, setIntegrations] = useState<PublicIntegration[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchIntegrations().then((result) => {
      if (result.ok) {
        setIntegrations(result.integrations)
        setError(null)
      } else {
        setError(result.error)
      }
      setIsLoading(false)
    })
  }, [])

  const refetch = useCallback(() => {
    setIsLoading(true)
    return fetchIntegrations().then((result) => {
      if (result.ok) {
        setIntegrations(result.integrations)
        setError(null)
      } else {
        setError(result.error)
      }
      setIsLoading(false)
    })
  }, [])

  return { integrations, isLoading, error, refetch }
}

export function useIntegrationDetail(id: string) {
  const { restaurantId, restaurants } = useTenant()
  const isAdmin = isTenantAdmin(restaurants, restaurantId)

  const [integration, setIntegration] = useState<PublicIntegration | null>(null)
  const [settings, setSettings] = useState<IntegrationSettingsView | null>(null)
  // WI-15: the settings fetch's own failure, distinct from `error` above
  // (which is the base-integration fetch's failure). Every UI slot gated on
  // "isAdmin && settings" used this failure's absence as its only signal,
  // so a non-403 failure silently rendered nothing — see
  // tests/2026-09-10-int-001-ui-walk.md Anomalies #1/#2 and
  // `settings-panel-state.ts`, which consumes `settingsError?.status`.
  const [settingsError, setSettingsError] = useState<{ status: number; error: string } | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // No synchronous setState before the first `.then()` here — every state
  // update is inside a promise callback (see the file header comment).
  const load = useCallback(() => {
    return fetchIntegrationDetail(id).then((detail) => {
      if (!detail.ok) {
        setNotFound(detail.status === 404)
        setError(detail.status === 404 ? null : detail.error)
        setIsLoading(false)
        return
      }
      setNotFound(false)
      setError(null)
      setIntegration(detail.integration)

      // GET .../settings is admin-gated server-side (requireTenantAdmin) —
      // skip the call entirely for staff rather than fetch-then-403.
      if (!isAdmin) {
        setIsLoading(false)
        return
      }
      return fetchIntegrationSettings(id).then((settingsResult) => {
        if (settingsResult.ok) {
          setSettings(settingsResult.settings)
          setSettingsError(null)
        } else {
          // Clear stale settings on a failed retry too — otherwise a
          // previously-successful fetch would keep rendering "ready" (with
          // now-stale data) even though this fetch failed.
          setSettings(null)
          setSettingsError({ status: settingsResult.status, error: settingsResult.error })
        }
        setIsLoading(false)
      })
    })
  }, [id, isAdmin])

  useEffect(() => {
    load()
  }, [load])

  const mutate = useCallback(() => {
    setIsLoading(true)
    return load()
  }, [load])

  return { integration, settings, settingsError, isAdmin, isLoading, notFound, error, mutate }
}
