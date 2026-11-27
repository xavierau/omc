'use client'

/**
 * BOOK-014 W2 (spec S1 AC-1, UI Feedback States): Settings → Booking →
 * Payments. Loads the account status from GET /api/dashboard/settings/payments;
 * when the page is the provider's onboarding return or refresh landing
 * (`?payments=return|refresh`, no account id), it asks the server to re-read
 * the stored account from the provider (`refresh=1`), then drops the marker
 * from the address. "Connect Stripe" / "Continue setup" POSTs connect and
 * sends the browser to the onboarding link the server returns.
 */
import { useCallback, useEffect, useState } from 'react'
import type { PaymentAccountView } from '@/application/payments/payment-account'

export type PaymentChip = 'none' | 'connecting' | 'active' | 'action_needed' | 'disconnected'
export type ConnectError = 'provider_unavailable' | 'error'

export interface PaymentAccountState {
  loading: boolean
  loadFailed: boolean
  account: PaymentAccountView | null
  canManage: boolean
}

const CHIP: Record<PaymentAccountView['status'], PaymentChip> = {
  pending: 'connecting',
  active: 'active',
  restricted: 'action_needed',
  disabled: 'disconnected',
}

export function paymentChip(account: PaymentAccountView | null): PaymentChip {
  if (!account) return 'none'
  if (account.status === 'active' && !account.chargesEnabled) return 'action_needed'
  return CHIP[account.status]
}

/** The deposit can be turned on (spec AC-4: only on an active account). */
export const paymentsActive = (account: PaymentAccountView | null) => paymentChip(account) === 'active'

/** "Continue setup" for an unfinished or restricted account; "Connect Stripe" for none or a disconnected one. */
export const connectAction = (chip: PaymentChip): 'connect' | 'continue' | null =>
  chip === 'active' ? null : chip === 'connecting' || chip === 'action_needed' ? 'continue' : 'connect'

/** The restriction reason's message key (Stripe's codes are shown only to admins, never to diners). */
export function reasonKey(reason: string | null): 'past_due' | 'rejected' | 'deauthorized' | 'other' | null {
  if (!reason) return null
  if (reason === 'deauthorized') return 'deauthorized'
  if (reason.startsWith('rejected.')) return 'rejected'
  if (reason.startsWith('requirements.')) return 'past_due'
  return 'other'
}

export function parsePaymentAccount(body: unknown): Pick<PaymentAccountState, 'account' | 'canManage'> | null {
  const b = body && typeof body === 'object' ? (body as { account?: unknown; canManage?: unknown }) : null
  if (!b || typeof b.canManage !== 'boolean') return null
  const a = b.account as PaymentAccountView | null | undefined
  if (a !== null && (typeof a !== 'object' || !a || !(a.status in CHIP))) return null
  return { account: a ?? null, canManage: b.canManage }
}

/** The landing marker the onboarding return / refresh URLs carry; nothing else in the address is read. */
function takeReturnMarker(): boolean {
  if (typeof window === 'undefined') return false
  const url = new URL(window.location.href)
  const marker = url.searchParams.get('payments')
  if (marker !== 'return' && marker !== 'refresh') return false
  url.searchParams.delete('payments')
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  return true
}

/** GET the status; null when it can't be read. `refresh` = re-read the stored account from the provider first. */
export async function fetchPaymentAccount(refresh: boolean): Promise<Pick<PaymentAccountState, 'account' | 'canManage'> | null> {
  try {
    const res = await fetch(`/api/dashboard/settings/payments${refresh ? '?refresh=1' : ''}`)
    return res.ok ? parsePaymentAccount(await res.json().catch(() => null)) : null
  } catch {
    return null
  }
}

export function usePaymentAccount() {
  const [state, setState] = useState<PaymentAccountState>({ loading: true, loadFailed: false, account: null, canManage: false })
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<ConnectError | null>(null)

  const apply = useCallback((parsed: Pick<PaymentAccountState, 'account' | 'canManage'> | null) => {
    setState((s) => (parsed ? { loading: false, loadFailed: false, ...parsed } : { ...s, loading: false, loadFailed: true }))
  }, [])

  useEffect(() => {
    let live = true
    void fetchPaymentAccount(takeReturnMarker()).then((parsed) => live && apply(parsed))
    return () => {
      live = false
    }
  }, [apply])

  async function connect() {
    setConnecting(true)
    setConnectError(null)
    try {
      const res = await fetch('/api/dashboard/settings/payments/connect', { method: 'POST' })
      const body = (await res.json().catch(() => null)) as { url?: unknown; error?: unknown } | null
      if (res.ok && typeof body?.url === 'string' && body.url.startsWith('https://')) {
        window.location.assign(body.url)
        return
      }
      if (res.status === 409) apply(await fetchPaymentAccount(false))
      else setConnectError(res.status === 502 ? 'provider_unavailable' : 'error')
    } catch {
      setConnectError('provider_unavailable')
    }
    setConnecting(false)
  }

  return { ...state, chip: paymentChip(state.account), connecting, connectError, connect }
}

export type PaymentAccountHook = ReturnType<typeof usePaymentAccount>
