'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useCampaigns } from '@/hooks/use-campaigns'

interface QrData { qrDataUrl: string; deepLink?: string; joinUrl?: string }

export function QrGenerator() {
  const t = useTranslations('qr')
  const tc = useTranslations('common')
  const { campaigns } = useCampaigns()
  const [qrData, setQrData] = useState<QrData | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [mode, setMode] = useState<'whatsapp' | 'web'>('whatsapp')
  const [campaignId, setCampaignId] = useState('')

  async function handleGenerate() {
    setLoading(true)
    try {
      if (mode === 'web') {
        const body: Record<string, string> = {}
        if (campaignId) body.campaignId = campaignId
        const res = await fetch('/api/dashboard/qr/web', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error('Failed')
        const data = await res.json()
        setQrData({ qrDataUrl: data.qrDataUrl, joinUrl: data.joinUrl })
      } else {
        const res = await fetch('/api/qr/generate', { method: 'POST' })
        if (!res.ok) throw new Error('Failed')
        const data = await res.json()
        setQrData({ qrDataUrl: data.qrDataUrl, deepLink: data.deepLink })
      }
    } catch { /* error handled by lack of qrData */ } finally {
      setLoading(false)
    }
  }

  function handleDownload() {
    if (!qrData) return
    const link = document.createElement('a')
    link.download = 'qr-code.png'
    link.href = qrData.qrDataUrl
    link.click()
  }

  async function handleCopyLink() {
    const url = qrData?.joinUrl ?? qrData?.deepLink
    if (!url) return
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const activeCampaigns = campaigns.filter(c => c.status === 'active')
  const displayUrl = qrData?.joinUrl ?? qrData?.deepLink

  if (!qrData) {
    return (
      <GenerateForm mode={mode} onModeChange={setMode} campaignId={campaignId}
        onCampaignChange={setCampaignId} campaigns={activeCampaigns}
        loading={loading} onGenerate={handleGenerate} t={t} />
    )
  }

  return (
    <div className="flex flex-col items-center space-y-6">
      <QrDisplay qrDataUrl={qrData.qrDataUrl} t={t} />
      {displayUrl && (
        <div className="bg-muted rounded-md px-4 py-2 text-sm text-muted-foreground font-mono break-all max-w-md text-center">
          {displayUrl}
        </div>
      )}
      <div className="flex gap-3">
        <Button onClick={handleDownload}>{t('downloadPng')}</Button>
        <Button variant="outline" onClick={handleCopyLink}>
          {copied ? tc('copied') : tc('copyLink')}
        </Button>
        <Button variant="outline" onClick={() => { setQrData(null); setCopied(false) }}>
          {tc('regenerate')}
        </Button>
      </div>
    </div>
  )
}

function QrDisplay({ qrDataUrl, t }: { qrDataUrl: string; t: (k: string) => string }) {
  return (
    <Card className="p-8">
      <CardContent className="flex flex-col items-center p-0 space-y-4">
        <p className="text-lg font-semibold text-foreground">{t('brandName')}</p>
        <img src={qrDataUrl} alt="QR Code" className="w-[300px] h-[300px]" />
        <p className="text-sm text-muted-foreground">{t('scanToEarn')}</p>
        <p className="text-xs text-muted-foreground">{t('joinMessage')}</p>
      </CardContent>
    </Card>
  )
}

function GenerateForm({ mode, onModeChange, campaignId, onCampaignChange, campaigns, loading, onGenerate, t }: {
  mode: string; onModeChange: (v: 'whatsapp' | 'web') => void
  campaignId: string; onCampaignChange: (v: string) => void
  campaigns: { id: string; name: string | null }[]
  loading: boolean; onGenerate: () => void; t: (k: string) => string
}) {
  return (
    <div className="flex flex-col items-center space-y-4 py-12">
      <div className="flex gap-3 items-center">
        <label className="text-sm font-medium">{t('mode')}</label>
        <select value={mode} onChange={e => onModeChange(e.target.value as 'whatsapp' | 'web')}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm">
          <option value="whatsapp">WhatsApp</option>
          <option value="web">Web</option>
        </select>
      </div>
      {campaigns.length > 0 && (
        <div className="flex gap-3 items-center">
          <label className="text-sm font-medium">{t('campaign')}</label>
          <select value={campaignId} onChange={e => onCampaignChange(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">{t('noCampaign')}</option>
            {campaigns.map(c => <option key={c.id} value={c.id}>{c.name ?? c.id}</option>)}
          </select>
        </div>
      )}
      <Button onClick={onGenerate} disabled={loading} size="lg">
        {loading ? t('generating') : t('generateQrCode')}
      </Button>
    </div>
  )
}
