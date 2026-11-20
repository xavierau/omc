'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Image from 'next/image'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

// WONB-020 r1: an existing never-welcomed member is sent to WhatsApp to claim.
export function claimUrlFrom(data: { existing?: boolean; claimOnWhatsApp?: boolean; whatsappClaimUrl?: string }): string | null {
  const url = data.existing && data.claimOnWhatsApp ? data.whatsappClaimUrl : undefined
  return url?.startsWith('https://wa.me/') ? url : null
}

function useJoinSubmit(slug: string) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [claimUrl, setClaimUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (phone: string, name: string) => {
    setError('')
    setClaimUrl(null)
    setLoading(true)
    try {
      const res = await fetch(`/api/join/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, name }),
      })
      const data = await res.json()

      if (res.status === 403) return setError('promotion_unavailable')
      if (!res.ok) return setError(data.error ?? 'Something went wrong.')
      const claim = claimUrlFrom(data)
      if (claim) return setClaimUrl(claim)
      if (data.existing) return setError('already_member')
      router.push(`/join/${slug}/success?code=${data.couponCode}`)
    } catch {
      return setError('generic_error')
    } finally {
      setLoading(false)
    }
  }

  return { error, claimUrl, loading, submit, setError }
}

export function SlugJoinForm({ slug, tenantName, logoUrl }: { slug: string; tenantName: string; logoUrl: string | null }) {
  const t = useTranslations('join')
  const [phone, setPhone] = useState('+852')
  const [name, setName] = useState('')
  const { error, claimUrl, loading, submit, setError } = useJoinSubmit(slug)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!phone.trim() || phone.trim() === '+852' || !name.trim()) {
      setError('fields_required')
      return
    }
    submit(phone.trim(), name.trim())
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        {logoUrl && (
          <Image src={logoUrl} alt={tenantName} width={80} height={80} className="mx-auto h-20 w-20 rounded-lg object-cover" unoptimized />
        )}
        <h1 className="text-3xl font-bold tracking-tight">{tenantName}</h1>
        <CardTitle className="text-lg font-semibold">{t('heading')}</CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="phone" className="text-sm font-medium">
              {t('phone')}
            </label>
            <Input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={loading}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="name" className="text-sm font-medium">
              {t('name')}
            </label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('namePlaceholder')}
              disabled={loading}
            />
          </div>
          <JoinFormNotice error={error} claimUrl={claimUrl} />
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? t('submitting') : t('submit')}
          </Button>
        </form>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Powered by <span className="font-medium">OhMyClient</span>
        </p>
      </CardContent>
    </Card>
  )
}

export function JoinFormNotice({ error, claimUrl }: { error: string; claimUrl: string | null }) {
  const t = useTranslations('join')
  if (claimUrl) {
    return (
      <div data-testid="join-claim-whatsapp" className="space-y-3">
        <p className="text-sm">{t('claimOnWhatsApp')}</p>
        <a
          data-testid="join-claim-whatsapp-link"
          href={claimUrl}
          className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {t('claimOnWhatsAppButton')}
        </a>
      </div>
    )
  }
  const errorMessage = resolveError(error, t)
  return errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null
}

function resolveError(error: string, t: (key: string) => string): string {
  if (!error) return ''
  if (error === 'fields_required') return t('fieldsRequired')
  if (error === 'already_member') return t('alreadyMember')
  if (error === 'generic_error') return t('genericError')
  if (error === 'promotion_unavailable') return t('promotionUnavailable')
  return error
}
