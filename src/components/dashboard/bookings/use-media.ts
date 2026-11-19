'use client'

/**
 * BOOK-004: phone (< 768px) vs desktop, so each view renders ONE layout and
 * every booking row exists once in the DOM (no hidden desktop+phone copies).
 * Before hydration it reads as desktop.
 */
import { useSyncExternalStore } from 'react'

const PHONE_QUERY = '(max-width: 767px)'

function subscribe(onChange: () => void) {
  const media = window.matchMedia(PHONE_QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(PHONE_QUERY).matches, () => false)
}
