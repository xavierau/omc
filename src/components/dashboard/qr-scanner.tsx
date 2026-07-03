'use client'

import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { QR_CONFIG, watchViewportChange } from './qr-scanner-helpers'

interface QrScannerProps {
  onScan: (text: string) => void
  active: boolean
}

const CONTAINER_ID = 'qr-reader'

export function QrScanner({ onScan, active }: QrScannerProps) {
  const onScanRef = useRef(onScan)
  useEffect(() => { onScanRef.current = onScan })

  // html5-qrcode sizes the video and qrbox once at start; bump the tick on
  // real width changes (rotation) so the effect below restarts the scanner.
  const [viewportTick, setViewportTick] = useState(0)
  useEffect(() => {
    if (!active) return
    return watchViewportChange(window, () => setViewportTick((t) => t + 1))
  }, [active])

  // Start/stop pairs are serialized through sessionRef: a restart's start()
  // never runs before the previous session has fully stopped, so two camera
  // streams are never open at once and no scanner instance is orphaned.
  const sessionRef = useRef<Promise<void>>(Promise.resolve())
  useEffect(() => {
    if (!active) return
    let cancelled = false
    let stopScanner: (() => Promise<void>) | null = null

    sessionRef.current = sessionRef.current.then(async () => {
      if (cancelled) return
      const scanner = new Html5Qrcode(CONTAINER_ID)
      try {
        await scanner.start(
          { facingMode: 'environment' },
          QR_CONFIG,
          (decodedText) => onScanRef.current(decodedText),
          () => {}
        )
      } catch {
        if (!cancelled) onScanRef.current('')
        return
      }
      stopScanner = async () => {
        try {
          if (scanner.isScanning) await scanner.stop()
          scanner.clear()
        } catch {
          // Camera may already be stopped
        }
      }
      if (cancelled) {
        const stop = stopScanner
        stopScanner = null
        await stop()
      }
    })

    return () => {
      cancelled = true
      sessionRef.current = sessionRef.current.then(async () => {
        if (stopScanner) await stopScanner()
      })
    }
  }, [active, viewportTick])

  return (
    <div
      id={CONTAINER_ID}
      className="mx-auto max-w-[400px] aspect-square overflow-hidden rounded-lg"
    />
  )
}
