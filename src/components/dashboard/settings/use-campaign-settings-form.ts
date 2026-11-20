'use client'

import { useState } from 'react'
import {
  saveCampaignAudienceSettings,
  type CampaignAudienceSettings,
} from '@/hooks/use-campaign-audience-settings'
import { formFromSettings, formToBody, isDirty, lapsedDaysValue, type CampaignSettingsForm } from './campaign-settings-form'

/** Edit, validate, save and discard the Campaigns group (one Save for the whole group). */
export function useCampaignSettingsForm(initial: CampaignAudienceSettings) {
  const [saved, setSaved] = useState<CampaignSettingsForm>(() => formFromSettings(initial))
  const [form, setForm] = useState<CampaignSettingsForm>(saved)
  const [saving, setSaving] = useState(false)
  const [outcome, setOutcome] = useState<'saved' | 'error' | null>(null)

  const update = (patch: Partial<CampaignSettingsForm>) => {
    setForm((f) => ({ ...f, ...patch }))
    setOutcome(null)
  }
  const dirty = isDirty(form, saved)
  const lapsedInvalid = lapsedDaysValue(form.lapsedDays) === null
  const body = formToBody(form)

  async function save() {
    if (!body) return
    setSaving(true)
    try {
      await saveCampaignAudienceSettings(body)
      setSaved(form)
      setOutcome('saved')
    } catch {
      setOutcome('error')
    } finally {
      setSaving(false)
    }
  }

  return {
    form,
    update,
    dirty,
    lapsedInvalid,
    canSave: dirty && body !== null,
    saving,
    outcome,
    save,
    discard: () => { setForm(saved); setOutcome(null) },
  }
}
