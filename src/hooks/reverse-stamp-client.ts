'use client'

// POST /api/dashboard/scan/stamp/reverse (plan §9, subtask 15) — the audited "remove a
// stamp" correction surfaced on the member detail panel. The backend writes the
// stamp_reversal event with the actor and floors the count at 0; this helper normalizes
// the response so the UI can reflect the new count or surface the at-zero / no-campaign
// cases.
export type ReverseOutcome = 'reversed' | 'at_zero' | 'no_active_campaign' | 'error'

export interface ReverseStampResult {
  outcome: ReverseOutcome
  stampsCount: number
  stampsRequired: number
}

export async function reverseStamp(memberId: string): Promise<ReverseStampResult> {
  try {
    const res = await fetch('/api/dashboard/scan/stamp/reverse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId }),
    })
    const json = await res.json().catch(() => ({}))
    if (typeof json.error === 'string') {
      const outcome: ReverseOutcome = json.error === 'no_active_campaign' ? 'no_active_campaign' : 'error'
      return { outcome, stampsCount: 0, stampsRequired: 0 }
    }
    return {
      outcome: (json.outcome as ReverseOutcome) ?? 'reversed',
      stampsCount: Number(json.stampsCount ?? 0),
      stampsRequired: Number(json.stampsRequired ?? 0),
    }
  } catch {
    return { outcome: 'error', stampsCount: 0, stampsRequired: 0 }
  }
}
