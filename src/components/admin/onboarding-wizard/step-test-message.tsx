'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface Props {
  kapsoPhoneNumberId: string
}

export function StepTestMessage({ kapsoPhoneNumberId }: Props) {
  const t = useTranslations('onboarding')
  const [testPhone, setTestPhone] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [result, setResult] = useState<'success' | 'error' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSend() {
    setIsSending(true)
    setResult(null)
    setError(null)
    try {
      const res = await fetch('/api/admin/tenants/send-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kapsoPhoneNumberId, toNumber: testPhone }),
      })
      const body = await res.json()
      if (body.sent) {
        setResult('success')
      } else {
        setResult('error')
        setError(body.error ?? t('testFailed'))
      }
    } catch {
      setResult('error')
      setError(t('testFailed'))
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('testTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('testDescription')}</p>
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">
          {t('testPhoneNumber')}
        </label>
        <p className="text-xs text-muted-foreground">{t('testPhoneHint')}</p>
        <div className="flex gap-2">
          <Input
            value={testPhone}
            onChange={e => setTestPhone(e.target.value)}
            placeholder="+852 9123 4567"
          />
          <Button
            type="button"
            disabled={!testPhone.trim() || isSending}
            onClick={handleSend}
          >
            {isSending ? t('sendingTest') : t('sendTest')}
          </Button>
        </div>
      </div>
      {result === 'success' && (
        <div className="flex items-center gap-2 rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
          <span className="text-green-600">{'\u2713'}</span>
          <span>{t('testSuccess')}</span>
        </div>
      )}
      {result === 'error' && error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  )
}
