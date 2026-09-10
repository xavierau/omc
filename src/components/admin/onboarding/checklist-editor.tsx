'use client'

import { useTranslations } from 'next-intl'
import {
  CHECKLIST_KEYS,
  type ChecklistKey,
  type PreKickoffChecklist,
} from '@/domain/value-objects/pre-kickoff-checklist'
import { isChecklistItemInteractive } from '@/components/admin/onboarding/onboarding-view-helpers'

interface ChecklistEditorProps {
  checklist: PreKickoffChecklist
  onToggle: (key: ChecklistKey, checked: boolean) => void
}

export function ChecklistEditor({ checklist, onToggle }: ChecklistEditorProps) {
  const t = useTranslations('admin.onboarding')
  return (
    <ul className="flex flex-col gap-2">
      {CHECKLIST_KEYS.map((key) => {
        const item = checklist[key]
        const interactive = isChecklistItemInteractive(item)
        return (
          <li
            key={key}
            data-checklist-row={key}
            data-status={item.status}
            className={
              interactive
                ? 'flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm'
                : 'flex items-center gap-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground'
            }
          >
            <input
              type="checkbox"
              name={key}
              checked={item.checked}
              disabled={!interactive}
              onChange={(e) => onToggle(key, e.target.checked)}
              className="size-4 accent-primary disabled:opacity-60"
            />
            <span className="flex-1">{t(`checklist.${key}`)}</span>
            {!interactive && (
              <span className="text-xs uppercase tracking-wide">
                {t('checklist.notApplicable')}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
