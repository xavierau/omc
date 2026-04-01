'use client'

import { useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Camera } from 'lucide-react'
import { QrScanner } from '@/components/dashboard/qr-scanner'
import { ScanResultCard } from '@/components/dashboard/scan-result-card'
import { Card, CardContent } from '@/components/ui/card'

type ScanState = 'idle' | 'preview' | 'result'

interface CouponInfo {
  code: string
  type: string
  discountType: string | null
  discountValue: number | null
  expiresAt: string | null
  currentUses: number
  maxUses: number | null
  description: string | null
  status: string
  isActive: boolean
}

function parseCode(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed.startsWith('REDEEM ')) return trimmed.slice(7)
  if (/^[A-Za-z0-9_-]{3,}$/.test(trimmed)) return trimmed
  return null
}

function CameraPermissionCard({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <Card>
      <CardContent className="pt-6 text-center space-y-3">
        <Camera className="mx-auto size-12 text-muted-foreground" />
        <p className="font-semibold">{t('cameraPermissionDenied')}</p>
        <p className="text-sm text-muted-foreground">{t('cameraPermissionHint')}</p>
      </CardContent>
    </Card>
  )
}

export default function ScanPage() {
  const t = useTranslations('scan')
  const [state, setState] = useState<ScanState>('idle')
  const [coupon, setCoupon] = useState<CouponInfo | null>(null)
  const [scannedCode, setScannedCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cameraBlocked, setCameraBlocked] = useState(false)

  const onScan = useCallback((text: string) => {
    if (!text) { setCameraBlocked(true); return }
    const code = parseCode(text)
    if (!code) { setError(t('invalidQr')); setState('preview'); return }
    setScannedCode(code)
    setCoupon({ code, type: '', discountType: null, discountValue: null, expiresAt: null, currentUses: 0, maxUses: null, description: null, status: 'active', isActive: true })
    setError(null)
    setResult(null)
    setState('preview')
  }, [t])

  const onConfirm = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/dashboard/scan/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: scannedCode }),
      })
      const data = await res.json()
      setResult({ success: res.ok, message: data.message ?? (res.ok ? 'OK' : 'Error') })
    } catch {
      setResult({ success: false, message: t('couponNotFound') })
    }
    setLoading(false)
    setState('result')
  }, [scannedCode, t])

  const onScanAnother = useCallback(() => {
    setState('idle')
    setCoupon(null)
    setResult(null)
    setError(null)
    setScannedCode('')
  }, [])

  return (
    <div className="p-6 max-w-lg mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('heading')}</h1>
        <p className="text-muted-foreground mt-1">{t('subtitle')}</p>
      </div>

      {cameraBlocked && <CameraPermissionCard t={t} />}

      {!cameraBlocked && state === 'idle' && (
        <>
          <QrScanner onScan={onScan} active={state === 'idle'} />
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
    </div>
  )
}
