'use client'

import { useEffect, useState } from 'react'

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

const COUNT_URL = '/api/dashboard/receipts/flagged/count'
const DECIDE_URL = '/api/dashboard/receipts/flagged'
const CHANGED = 'flagged-receipts-changed'

// The pill lives in the Settings shell; decisions happen in FlaggedReceiptsPanel
// inside a group page. One module-level signal connects them.
const changes = new EventTarget()

export function onFlaggedReceiptsChanged(listener: () => void): () => void {
  changes.addEventListener(CHANGED, listener)
  return () => changes.removeEventListener(CHANGED, listener)
}

/** The flagged count (a head count server-side). Silent on failure: 0, so the pill just doesn't show. */
export async function fetchFlaggedReceiptCount(fetcher: Fetcher = fetch, signal?: AbortSignal): Promise<number> {
  try {
    const res = await fetcher(COUNT_URL, { signal })
    if (!res.ok) return 0
    const data = (await res.json()) as { count?: unknown }
    return typeof data.count === 'number' ? data.count : 0
  } catch {
    return 0
  }
}

/** Approve or reject one flagged receipt; on success the pill refreshes. */
export async function decideFlaggedReceipt(
  receiptId: string,
  action: 'approve' | 'reject',
  fetcher: Fetcher = fetch
): Promise<boolean> {
  const res = await fetcher(DECIDE_URL, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ receiptId, action }),
  })
  if (!res.ok) return false
  changes.dispatchEvent(new Event(CHANGED))
  return true
}

/** The "N flagged" pill on the Receipts group. */
export function useFlaggedReceiptCount(): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const load = () => { fetchFlaggedReceiptCount(fetch, controller.signal).then((n) => !controller.signal.aborted && setCount(n)) }
    load()
    const off = onFlaggedReceiptsChanged(load)
    return () => { off(); controller.abort() }
  }, [])
  return count
}
