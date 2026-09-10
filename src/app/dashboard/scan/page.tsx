'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Camera } from 'lucide-react'
import { ScanModeToggle, type ScanMode } from '@/components/dashboard/scan-mode-toggle'
import { ScanRedeemFlow } from '@/components/dashboard/scan-redeem-flow'
import { ScanStampFlow } from '@/components/dashboard/scan-stamp-flow'
import { Card, CardContent } from '@/components/ui/card'

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
  const [mode, setMode] = useState<ScanMode>('redeem')
  const [cameraBlocked, setCameraBlocked] = useState(false)

  const handleModeChange = (next: ScanMode) => {
    setCameraBlocked(false)
    setMode(next)
  }

  return (
    <div className="p-6 max-w-lg mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('heading')}</h1>
        <p className="text-muted-foreground mt-1">
          {mode === 'stamp' ? t('stampSubtitle') : t('subtitle')}
        </p>
      </div>

      <ScanModeToggle mode={mode} onChange={handleModeChange} />

      {cameraBlocked ? (
        <CameraPermissionCard t={t} />
      ) : mode === 'stamp' ? (
        <ScanStampFlow key="stamp" onCameraBlocked={() => setCameraBlocked(true)} />
      ) : (
        <ScanRedeemFlow key="redeem" onCameraBlocked={() => setCameraBlocked(true)} />
      )}
    </div>
  )
}
