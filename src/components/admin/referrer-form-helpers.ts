import type { useTranslations } from 'next-intl'

export interface ReferrerFormState {
  name: string
  contactEmail: string
  contactPhone: string
  commissionPerMessageHkd: string
  commissionPerRedemptionHkd: string
  status: string
}

export const DEFAULT_COMMISSION_PER_MESSAGE = '0.05'
export const DEFAULT_COMMISSION_PER_REDEMPTION = '0.10'

export const initialReferrerForm: ReferrerFormState = {
  name: '',
  contactEmail: '',
  contactPhone: '',
  commissionPerMessageHkd: DEFAULT_COMMISSION_PER_MESSAGE,
  commissionPerRedemptionHkd: DEFAULT_COMMISSION_PER_REDEMPTION,
  status: 'active',
}

type AdminT = ReturnType<typeof useTranslations<'admin'>>

export function validateForm(
  form: ReferrerFormState,
  t: AdminT
): string | null {
  if (!form.name.trim()) return t('referrerNameRequired')
  if (!form.contactEmail.trim()) return t('referrerEmailRequired')
  if (!isCommissionRateValid(form.commissionPerMessageHkd)) {
    return t('commissionMessageInvalid')
  }
  if (!isCommissionRateValid(form.commissionPerRedemptionHkd)) {
    return t('commissionRedemptionInvalid')
  }
  return null
}

export function isCommissionRateValid(raw: string): boolean {
  if (raw === '') return true
  const value = Number(raw)
  if (Number.isNaN(value)) return false
  return value >= 0 && value <= 1
}

// Convert a raw form value to a request payload value.
// Empty string => undefined (omit from JSON → DB default applies).
// Non-empty string => Number (caller-validated range).
function toOptionalRate(raw: string): number | undefined {
  return raw === '' ? undefined : Number(raw)
}

export function buildRequestBody(
  form: ReferrerFormState,
  isEdit: boolean
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: form.name,
    contactEmail: form.contactEmail,
    contactPhone: form.contactPhone || null,
  }

  const messageRate = toOptionalRate(form.commissionPerMessageHkd)
  if (messageRate !== undefined) {
    body.commissionPerMessageHkd = messageRate
  }

  const redemptionRate = toOptionalRate(form.commissionPerRedemptionHkd)
  if (redemptionRate !== undefined) {
    body.commissionPerRedemptionHkd = redemptionRate
  }

  if (isEdit) body.status = form.status
  return body
}
