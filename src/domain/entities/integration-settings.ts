// INT-001: 1:1 with pos_integrations. T-H1: this entity NEVER carries
// `outbound_secret_enc` -- the mapper (infrastructure layer) must not map
// that column onto it, so no `SELECT *`-style read can leak the ciphertext
// (let alone the plaintext) past the repository boundary. The decrypted
// secret is available ONLY via `readOutboundSecret(integrationId)`
// (integration-settings-repository.ts), called by the delivery path alone.

export type OutboundStatus = 'active' | 'paused_auto' | 'paused_manual'

export interface IntegrationSettingsProps {
  integrationId: string
  restaurantId: string
  newJoinTemplateId: string | null
  consentAttestationText: string | null
  consentAttestationAckAt: string | null
  consentAttestationAckBy: string | null
  outboundUrl: string | null
  outboundSecretLast4: string | null
  outboundSecretUpdatedAt: string | null
  outboundSecretUpdatedBy: string | null
  outboundEvents: string[]
  outboundEnabled: boolean
  outboundPiiAckAt: string | null
  outboundPiiAckBy: string | null
  outboundStatus: OutboundStatus
  outboundFailureStreak: number
  outboundPausedAt: string | null
  inboundRatePerMin: number | null
  inboundBurst: number | null
  inboundQueueCap: number | null
  inboundSecretUpdatedAt: string | null
  createdAt: string
  updatedAt: string
}

const NEW_JOIN_TEMPLATE_UUID = /^[0-9a-f-]{36}$/i

export class IntegrationSettings {
  private constructor(private readonly props: IntegrationSettingsProps) {}

  static fromProps(props: IntegrationSettingsProps): IntegrationSettings {
    assertNewJoinTemplateId(props.newJoinTemplateId)
    assertOutboundEnabledInvariant(props)
    return new IntegrationSettings(props)
  }

  get snapshot(): Readonly<IntegrationSettingsProps> {
    return this.props
  }
}

function assertNewJoinTemplateId(value: string | null): void {
  if (value === null || value === 'default') return
  if (NEW_JOIN_TEMPLATE_UUID.test(value)) return
  throw new Error(
    `IntegrationSettings: new_join_template_id must be null, 'default', or a uuid (got ${JSON.stringify(value)})`
  )
}

function assertOutboundEnabledInvariant(props: IntegrationSettingsProps): void {
  if (!props.outboundEnabled) return
  const missing: string[] = []
  if (!props.outboundUrl) missing.push('outboundUrl')
  if (!props.outboundPiiAckAt) missing.push('outboundPiiAckAt')
  if (!props.outboundSecretLast4) missing.push('outboundSecret')
  if (missing.length > 0) {
    throw new Error(
      `IntegrationSettings: outbound_enabled requires ${missing.join(', ')}`
    )
  }
}
