'use client'

import { Button } from '@/components/ui/button'
import { STEP_COUNT } from './types'

interface Props {
  step: number
  canNext: boolean
  isCreating: boolean
  onBack: () => void
  onNext: () => void
  onSkip: () => void
  onCreate: () => void
  labels: { back: string; next: string; skip: string; create: string; creating: string }
}

export function WizardNav({
  step, canNext, isCreating, onBack, onNext, onSkip, onCreate, labels,
}: Props) {
  return (
    <div className="flex gap-3">
      {step > 1 && (
        <Button type="button" variant="outline" onClick={onBack} disabled={isCreating}>
          {labels.back}
        </Button>
      )}
      {step === 3 && (
        <Button type="button" variant="outline" onClick={onSkip}>
          {labels.skip}
        </Button>
      )}
      {step < STEP_COUNT && (
        <Button type="button" disabled={!canNext} onClick={onNext}>
          {labels.next}
        </Button>
      )}
      {step === STEP_COUNT && (
        <Button type="button" disabled={isCreating} onClick={onCreate}>
          {isCreating ? labels.creating : labels.create}
        </Button>
      )}
    </div>
  )
}
