import type { WizardData } from './types'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function canProceedFromStep1(data: WizardData): boolean {
  return !!(
    data.name.trim() &&
    SLUG_REGEX.test(data.slug) &&
    EMAIL_REGEX.test(data.adminEmail) &&
    data.adminPassword.length >= 8 &&
    data.whatsappNumber.trim()
  )
}

export function canProceedFromStep2(isValidated: boolean): boolean {
  return isValidated
}
