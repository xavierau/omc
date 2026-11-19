'use client'

import { useEffect, useState } from 'react'

/** The "N flagged" pill on the Receipts group. Silent on failure: the pill just doesn't show. */
export function useFlaggedReceiptCount(): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/dashboard/receipts/flagged', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : { receipts: [] }))
      .then((data) => setCount(Array.isArray(data.receipts) ? data.receipts.length : 0))
      .catch(() => {})
    return () => controller.abort()
  }, [])
  return count
}
