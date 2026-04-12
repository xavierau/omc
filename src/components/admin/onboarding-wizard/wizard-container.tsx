'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Card, CardContent } from '@/components/ui/card'
import { StepIndicator } from './step-indicator'
import { StepTenantInfo } from './step-tenant-info'
import { StepWhatsappConnect } from './step-whatsapp-connect'
import { StepTestMessage } from './step-test-message'
import { StepReview } from './step-review'
import { WizardNav } from './wizard-nav'
import { canProceedFromStep1 } from './use-wizard-validation'
import { INITIAL_WIZARD_DATA, type WizardData } from './types'

export function WizardContainer() {
  const router = useRouter()
  const t = useTranslations('onboarding')
  const [step, setStep] = useState(1)
  const [data, setData] = useState<WizardData>(INITIAL_WIZARD_DATA)
  const [whatsappValidated, setWhatsappValidated] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  function handleChange(patch: Partial<WizardData>) {
    setData(prev => ({ ...prev, ...patch }))
  }

  function canNext(): boolean {
    if (step === 1) return canProceedFromStep1(data)
    if (step === 2) return whatsappValidated
    return true
  }

  const creatingRef = { current: false }

  async function handleCreate() {
    if (creatingRef.current) return
    creatingRef.current = true
    setIsCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? t('createFailed'))
      }
      const created = await res.json()
      router.push(`/admin/tenants/${created.id}`)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : t('createFailed'))
    } finally {
      creatingRef.current = false
      setIsCreating(false)
    }
  }

  const navLabels = {
    back: t('back'),
    next: t('next'),
    skip: t('skipStep'),
    create: t('createTenant'),
    creating: t('creatingTenant'),
  }

  return (
    <div className="space-y-6 max-w-lg">
      <StepIndicator current={step} />
      <Card>
        <CardContent>
          {step === 1 && <StepTenantInfo data={data} onChange={handleChange} />}
          {step === 2 && (
            <StepWhatsappConnect
              data={data}
              onChange={handleChange}
              onValidated={setWhatsappValidated}
              isValidated={whatsappValidated}
            />
          )}
          {step === 3 && (
            <StepTestMessage kapsoPhoneNumberId={data.kapsoPhoneNumberId} />
          )}
          {step === 4 && <StepReview data={data} />}
          {createError && (
            <p className="mt-3 text-sm text-destructive">{createError}</p>
          )}
        </CardContent>
      </Card>
      <WizardNav
        step={step}
        canNext={canNext()}
        isCreating={isCreating}
        onBack={() => setStep(s => s - 1)}
        onNext={() => setStep(s => s + 1)}
        onSkip={() => setStep(s => s + 1)}
        onCreate={handleCreate}
        labels={navLabels}
      />
    </div>
  )
}
