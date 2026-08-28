'use client'

import type { StampResult, StampOutcome } from './use-give-stamp'

// Network helpers for the Give-Stamp flow. The scan path POSTs the decoded payload
// UN-STRIPPED (LOYALTY:/REDEEM /JOIN- prefix kept) so the server resolver sees it; the
// by-member path feeds a phone-looked-up memberId. Both normalize a server error body
// ({ error }) into a StampResult outcome the StampResultCard can render uniformly.
type StampRequest = { rawScan: string } | { memberId: string }

const ERROR_OUTCOMES: StampOutcome[] = ['no_active_campaign', 'not_resolved']

function normalize(json: Record<string, unknown>): StampResult {
  if (typeof json.error === 'string') {
    const outcome = ERROR_OUTCOMES.includes(json.error as StampOutcome)
      ? (json.error as StampOutcome)
      : 'not_resolved'
    return { outcome, stampsCount: 0, stampsRequired: 0, completed: false }
  }
  return {
    outcome: (json.outcome as StampOutcome) ?? 'stamped',
    stampsCount: Number(json.stampsCount ?? 0),
    stampsRequired: Number(json.stampsRequired ?? 0),
    completed: Boolean(json.completed),
  }
}

export async function postStamp(payload: StampRequest): Promise<StampResult> {
  const url =
    'memberId' in payload
      ? '/api/dashboard/scan/stamp/by-member'
      : '/api/dashboard/scan/stamp'
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const json = await res.json().catch(() => ({}))
    return normalize(json as Record<string, unknown>)
  } catch {
    return { outcome: 'not_resolved', stampsCount: 0, stampsRequired: 0, completed: false }
  }
}

export async function lookupMemberByPhone(phone: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/dashboard/members/lookup?phone=${encodeURIComponent(phone)}`)
    const json = await res.json().catch(() => ({}))
    return typeof json.memberId === 'string' ? json.memberId : null
  } catch {
    return null
  }
}
