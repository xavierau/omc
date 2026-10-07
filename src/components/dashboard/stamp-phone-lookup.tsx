'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface StampPhoneLookupProps {
  loading: boolean
  notFound: boolean
  onLookup: (phone: string) => void
  onAddMember: () => void
}

// The not_resolved backstop (plan §4.4 / §9): look the customer up by phone, then
// stamp by memberId; if the phone matches nobody, offer "Add as member" (links to the
// existing enrollment path — enrollment itself is NOT rebuilt here).
export function StampPhoneLookup({ loading, notFound, onLookup, onAddMember }: StampPhoneLookupProps) {
  const t = useTranslations('scan')
  const [phone, setPhone] = useState('')

  return (
    <div className="space-y-3" data-section="phone-lookup">
      <p className="text-sm text-muted-foreground">{t('stampLookupPrompt')}</p>
      <Input
        type="tel"
        inputMode="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder={t('stampPhonePlaceholder')}
        aria-label={t('stampPhonePlaceholder')}
      />
      <Button
        className="w-full"
        size="lg"
        onClick={() => onLookup(phone.trim())}
        disabled={loading || !phone.trim()}
      >
        {loading ? t('stampLookingUp') : t('stampLookupButton')}
      </Button>
      {notFound && (
        <div className="space-y-2 text-center">
          <p className="text-sm text-destructive">{t('stampMemberNotFound')}</p>
          <Button variant="outline" className="w-full" onClick={onAddMember}>
            {t('stampAddMember')}
          </Button>
        </div>
      )}
    </div>
  )
}
