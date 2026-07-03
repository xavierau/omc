'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { QR_CONFIG, watchViewportChange } from './qr-scanner-helpers'

interface QrScannerProps {
  onScan: (text: string) => void
  active: boolean
}

const CONTAINER_ID = 'qr-reader'

export function QrScanner({ onScan, active }: QrScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const onScanRef = useRef(onScan)
  useEffect(() => { onScanRef.current = onScan })

  // html5-qrcode sizes the video and qrbox once at start; bump the tick on
  // rotation/resize so the effect below restarts the scanner with fresh geometry.
  const [viewportTick, setViewportTick] = useState(0)
  useEffect(() => {
    if (!active) return
    return watchViewportChange(window, () => setViewportTick((t) => t + 1))
  }, [active])

  const stopScanner = useCallback(async () => {
    try {
      if (scannerRef.current?.isScanning) {
        await scannerRef.current.stop()
      }
      scannerRef.current?.clear()
    } catch {
      // Camera may already be stopped
    }
    scannerRef.current = null
  }, [])

  useEffect(() => {
    if (!active) {
      stopScanner()
      return
    }

    const scanner = new Html5Qrcode(CONTAINER_ID)
    scannerRef.current = scanner

    scanner
      .start(
        { facingMode: 'environment' },
        QR_CONFIG,
        (decodedText) => onScanRef.current(decodedText),
        () => {}
      )
      .catch(() => onScanRef.current(''))

    return () => { stopScanner() }
  }, [active, viewportTick, stopScanner])

  return (
    <div
      id={CONTAINER_ID}
      className="mx-auto max-w-[400px] aspect-square overflow-hidden rounded-lg"
    />
  )
}
