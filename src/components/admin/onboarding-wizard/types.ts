export interface WizardData {
  name: string
  slug: string
  adminEmail: string
  adminPassword: string
  whatsappNumber: string
  kapsoPhoneNumberId: string
  metaBusinessAccountId: string
}

export const INITIAL_WIZARD_DATA: WizardData = {
  name: '',
  slug: '',
  adminEmail: '',
  adminPassword: '',
  whatsappNumber: '',
  kapsoPhoneNumberId: '',
  metaBusinessAccountId: '',
}

export const STEP_COUNT = 4

export type StepProps = {
  data: WizardData
  onChange: (patch: Partial<WizardData>) => void
}
