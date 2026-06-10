'use client'

import { useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { QrScanner } from '@/components/dashboard/qr-scanner'
import { ScanResultCard } from '@/components/dashboard/scan-result-card'
import { fetchCoupon, redeemCoupon, type CouponInfo } from './scan-redeem-client'

type ScanState = 'idle' | 'preview' | 'result'

interface ScanRedeemFlowProps {
  onCameraBlocked: () => void
}

// Redeem-mode flow extracted VERBATIM from the original scan page so the give-stamp
// mode can be added without changing redeem routing. parseCode → /api/coupons →
// /api/dashboard/scan/redeem is unchanged.
export function ScanRedeemFlow({ onCameraBlocked }: ScanRedeemFlowProps) {
  const t = useTranslations('scan')
  const [state, setState] = useState<ScanState>('idle')
  const [coupon, setCoupon] = useState<CouponInfo | null>(null)
  const [scannedCode, setScannedCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const onScan = useCallback(async (text: string) => {
    if (!text) { onCameraBlocked(); return }
    const code = parseCode(text)
    if (!code) { setError(t('invalidQr')); setState('preview'); return }
    setScannedCode(code); setError(null); setResult(null); setLoading(true); setState('preview')
    const found = await fetchCoupon(code)
    if (!found) setError(t('couponNotFound'))
    setCoupon(found)
    setLoading(false)
  }, [t, onCameraBlocked])

  const onConfirm = useCallback(async () => {
    setLoading(true)
    setResult(await redeemCoupon(scannedCode, t))
    setLoading(false)
    setState('result')
  }, [scannedCode, t])

  const onScanAnother = useCallback(() => {
    setState('idle'); setCoupon(null); setResult(null); setError(null); setScannedCode('')
  }, [])

  return (
    <>
      {state === 'idle' && (
        <>
          <QrScanner onScan={onScan} active />
          <p className="text-center text-sm text-muted-foreground">{t('scanning')}</p>
        </>
      )}
      {state !== 'idle' && (
        <ScanResultCard
          coupon={coupon}
          loading={loading}
          result={result}
          error={error}
          onConfirm={onConfirm}
          onScanAnother={onScanAnother}
        />
      )}
    </>
  )
}

function parseCode(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed.startsWith('REDEEM ')) return trimmed.slice(7)
  if (/^[A-Za-z0-9_-]{3,}$/.test(trimmed)) return trimmed
  return null
}
