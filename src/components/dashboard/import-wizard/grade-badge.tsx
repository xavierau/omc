'use client'

import { useTranslations } from 'next-intl'

export type ConsentGrade = 'strong' | 'medium' | 'weak' | 'none'

interface Props {
  grade: ConsentGrade
}

const GRADE_CLASSES: Record<ConsentGrade, string> = {
  strong: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  medium: 'bg-amber-100 text-amber-900 border-amber-300',
  weak: 'bg-orange-100 text-orange-900 border-orange-300',
  none: 'bg-rose-100 text-rose-900 border-rose-300',
}

export function GradeBadge({ grade }: Props) {
  const t = useTranslations('importWizard')
  return (
    <span
      data-grade={grade}
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${GRADE_CLASSES[grade]}`}
    >
      {t(`grade.${grade}`)}
    </span>
  )
}
