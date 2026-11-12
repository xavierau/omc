import { resolveWabaId } from '@/infrastructure/whatsapp/templates'

interface ValidateResult {
  valid: boolean
  wabaId?: string
  error?: string
}

export async function validatePhoneNumberId(
  kapsoPhoneNumberId: string
): Promise<ValidateResult> {
  if (!kapsoPhoneNumberId) {
    return { valid: false, error: 'kapsoPhoneNumberId is required' }
  }

  try {
    const wabaId = await resolveWabaId(kapsoPhoneNumberId)
    if (!wabaId) {
      return {
        valid: false,
        error: 'Could not resolve WABA ID for this phone number',
      }
    }
    return { valid: true, wabaId }
  } catch (err) {
    console.error('validatePhoneNumberId error:', err)
    return { valid: false, error: 'Failed to validate phone number ID' }
  }
}
