import { describe, it, expect } from 'vitest'
import en from '../en.json'
import zhHK from '../zh-HK.json'

// INT-001 WI-9 — `locale-parity.test.ts` only proves en.json and zh-HK.json
// carry the SAME key set (stays green if a key is deleted from both). This
// pins every `integrations.*` string this WI's cards render (§8.2/§8.3
// feedback states, every settings error code, nav.integrations), so a
// silently-removed or never-added key fails loudly here instead of
// surfacing as a raw `integrations.xyz` string in production.
const REQUIRED_KEYS = [
  'heading',
  'description',
  'loadFailed',
  'notFound',
  'backToList',
  'createNameLabel',
  'createNamePlaceholder',
  'createNameRequired',
  'createFailed',
  'emptyTitle',
  'emptyDescription',
  'tabSettings',
  'tabActivity',
  'activityComingSoon',
  'adminOnlySettings',
  'inboundCardTitle',
  'inboundCardDescription',
  'webhookUrlLabel',
  'inboundSecretLabel',
  'secretMasked',
  'secretNotSet',
  'rotateSecret',
  'rotateConfirmWarning',
  'rotateConfirmButton',
  'rotating',
  'rotateRevealNotice',
  'rotateRevealDone',
  'welcomeCardTitle',
  'welcomeCardDescription',
  'welcomeChoiceOff',
  'welcomeChoiceDefault',
  'welcomeSpecificLabel',
  'welcomeSpecificUnknown',
  'welcomeHelperOff',
  'welcomeHelperPending',
  'welcomeHelperDefault',
  'welcomeMarketingNote',
  'welcomeWarningQualityPaused',
  'welcomeErrorTemplateLink',
  'savedIndicator',
  'attestationCardTitle',
  'attestationCardDescription',
  'attestationTextLabel',
  'attestationTextPlaceholder',
  'attestationAckLabel',
  'attestationGradeStrong',
  'attestationGradeWeak',
  'outboundCardTitle',
  'outboundCardDescription',
  'outboundUrlLabel',
  'outboundUrlPlaceholder',
  'outboundEventsLabel',
  'outboundPiiAckLabel',
  'outboundEnabledLabel',
  'outboundEnablePrereqHint',
  'statusActive',
  'statusPausedAuto',
  'statusPausedManual',
  'outboundSecretLabel',
  'outboundSecretPlaceholder',
  'outboundSecretSwapWarning',
  'outboundSecretConfirmButton',
  'outboundSecretSaved',
  'outboundTestSend',
  'outboundTestSending',
  'outboundTestQueued',
  'errorGeneric',
  'errorUnknownField',
  'errorInvalidTemplateId',
  'errorInvalidAttestationText',
  'errorInvalidAttestationAck',
  'errorInvalidEvents',
  'errorInvalidEnabled',
  'errorInvalidPiiAck',
  'errorTemplateNotFound',
  'errorTemplateNotApproved',
  'errorTemplateNotOwned',
  'errorNoDefaultTemplate',
  'errorUrlNotHttps',
  'errorUrlPrivateAddress',
  'errorUrlInvalid',
  'errorUrlPort',
  'errorUrlUserinfo',
  'errorPiiAckRequired',
  'errorSecretTooShort',
  'errorTestUrlNotSaved',
  'errorTestNotEligible',
  'errorIntegrationNotFound',
] as const

function readPath(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (node && typeof node === 'object') return (node as Record<string, unknown>)[key]
    return undefined
  }, root)
}

describe('integrations i18n keys (INT-001 WI-9)', () => {
  it.each([
    ['en', en],
    ['zh-HK', zhHK],
  ])('%s carries every integrations.* key as a non-empty string', (_locale, messages) => {
    const integrations = readPath(messages, 'integrations')
    const missing = REQUIRED_KEYS.filter((key) => {
      const value = readPath(integrations, key)
      return typeof value !== 'string' || value.trim().length === 0
    })
    expect(missing).toEqual([])
  })

  it.each([
    ['en', en],
    ['zh-HK', zhHK],
  ])('%s carries nav.integrations as a non-empty string', (_locale, messages) => {
    const value = readPath(messages, 'nav.integrations')
    expect(typeof value).toBe('string')
    expect((value as string).trim().length).toBeGreaterThan(0)
  })

  it('the integrations namespace has no keys beyond what this test tracks (catches an unlocalized new string)', () => {
    const enKeys = Object.keys((en as Record<string, unknown>).integrations as Record<string, unknown>).sort()
    expect(enKeys).toEqual([...REQUIRED_KEYS].sort())
  })
})
