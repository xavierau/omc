export class PhoneNumber {
  readonly value: string

  private constructor(value: string) {
    this.value = value
  }

  static create(raw: string): PhoneNumber {
    const cleaned = raw.replace(/[\s\-()]/g, '')
    const normalized = cleaned.startsWith('+') ? cleaned : `+${cleaned}`

    const digits = normalized.replace(/\D/g, '')
    if (digits.length < 8 || digits.length > 15) {
      throw new Error(`Invalid phone number: ${raw}`)
    }

    return new PhoneNumber(normalized)
  }

  get masked(): string {
    return '••••' + this.value.slice(-4)
  }
}
