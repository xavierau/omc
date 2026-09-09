'use client'

// INT-001 WI-9 — inbound (partner-signs) webhook URL + secret last4, with
// rotate-with-show-once (OQ-5, WI-0's `rotate-inbound-secret` route: the new
// secret is returned once, in that response only — every other dashboard
// read shows `secretLast4`, T-H1). The webhook URL itself isn't part of any
// GET payload (only `createIntegration`'s one-time create response carries
// it) — it's deterministic (`{origin}/api/webhooks/pos/{id}`, matching
// `configure-pos-integration.ts`'s own construction), so it's rebuilt
// client-side rather than requiring an API change (boundary: none).
//
// Split into a stateful container + a pure `InboundCredentialsView`, same
// reasoning as `integration-list.tsx` (no jsdom/RTL in this repo — only the
// pure view is render-tree-tested).

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { rotateInboundSecretRequest, type PublicIntegration } from '@/hooks/integrations-client'
import { settingsErrorMessageKey } from '@/components/dashboard/integrations/settings-error-messages'

export type RotateState = 'idle' | 'confirming' | 'rotating' | 'revealed'

export interface InboundCredentialsViewProps {
  webhookUrl: string
  secretLast4: string | null
  isAdmin: boolean
  rotateState: RotateState
  revealedSecret: string | null
  rotateError: string | null
  copiedField: 'webhookUrl' | 'secret' | null
  onCopy: (field: 'webhookUrl' | 'secret') => void
  onRequestRotate: () => void
  onCancelRotate: () => void
  onConfirmRotate: () => void
  onDismissReveal: () => void
}

/** Pure/props-driven. */
export function InboundCredentialsView({
  webhookUrl,
  secretLast4,
  isAdmin,
  rotateState,
  revealedSecret,
  rotateError,
  copiedField,
  onCopy,
  onRequestRotate,
  onCancelRotate,
  onConfirmRotate,
  onDismissReveal,
}: InboundCredentialsViewProps) {
  const t = useTranslations('integrations')
  const tc = useTranslations('common')

  return (
    <Card data-testid="inbound-credentials-card">
      <CardHeader>
        <CardTitle>{t('inboundCardTitle')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('inboundCardDescription')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="text-sm font-medium text-foreground mb-1 block">{t('webhookUrlLabel')}</label>
          <div className="flex items-center gap-2">
            <Input readOnly value={webhookUrl} data-testid="inbound-webhook-url" />
            <Button variant="outline" onClick={() => onCopy('webhookUrl')} data-testid="inbound-copy-url">
              {copiedField === 'webhookUrl' ? tc('copied') : tc('copyLink')}
            </Button>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-foreground mb-1 block">{t('inboundSecretLabel')}</label>
          <p className="text-sm text-muted-foreground" data-testid="inbound-secret-last4">
            {secretLast4 ? t('secretMasked', { last4: secretLast4 }) : t('secretNotSet')}
          </p>
        </div>

        {isAdmin && rotateState === 'idle' && (
          <Button variant="outline" onClick={onRequestRotate} data-testid="inbound-rotate-request">
            {t('rotateSecret')}
          </Button>
        )}

        {isAdmin && rotateState === 'confirming' && (
          <div className="space-y-2 rounded-md border border-border p-3" data-testid="inbound-rotate-confirm">
            <p className="text-xs text-muted-foreground">{t('rotateConfirmWarning')}</p>
            <div className="flex gap-2">
              <Button onClick={onConfirmRotate} data-testid="inbound-rotate-confirm-button">
                {t('rotateConfirmButton')}
              </Button>
              <Button variant="outline" onClick={onCancelRotate}>{tc('cancel')}</Button>
            </div>
          </div>
        )}

        {isAdmin && rotateState === 'rotating' && (
          <p className="text-sm text-muted-foreground" data-testid="inbound-rotating">{t('rotating')}</p>
        )}

        {isAdmin && rotateState === 'revealed' && revealedSecret && (
          <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3" data-testid="inbound-secret-reveal">
            <p className="text-xs font-medium text-amber-800">{t('rotateRevealNotice')}</p>
            <div className="flex items-center gap-2">
              <Input readOnly value={revealedSecret} data-testid="inbound-revealed-secret" />
              <Button variant="outline" onClick={() => onCopy('secret')} data-testid="inbound-copy-secret">
                {copiedField === 'secret' ? tc('copied') : tc('copyLink')}
              </Button>
            </div>
            <Button onClick={onDismissReveal} data-testid="inbound-reveal-done">{t('rotateRevealDone')}</Button>
          </div>
        )}

        {rotateError && (
          <p className="text-xs text-destructive" data-testid="inbound-rotate-error">{rotateError}</p>
        )}
      </CardContent>
    </Card>
  )
}

function webhookUrlFor(integrationId: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/api/webhooks/pos/${integrationId}`
}

export function InboundCredentialsCard({
  integration,
  isAdmin,
}: {
  integration: PublicIntegration
  isAdmin: boolean
}) {
  const t = useTranslations('integrations')
  const [secretLast4, setSecretLast4] = useState(integration.secretLast4)
  const [rotateState, setRotateState] = useState<RotateState>('idle')
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null)
  const [rotateError, setRotateError] = useState<string | null>(null)
  const [copiedField, setCopiedField] = useState<'webhookUrl' | 'secret' | null>(null)

  const webhookUrl = webhookUrlFor(integration.id)

  const onCopy = async (field: 'webhookUrl' | 'secret') => {
    const value = field === 'webhookUrl' ? webhookUrl : revealedSecret
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // Clipboard unavailable (permissions/non-secure context) — the value
      // is still visible and selectable in the input; nothing to recover.
    }
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }

  const onRequestRotate = () => {
    setRotateError(null)
    setRotateState('confirming')
  }

  const onCancelRotate = () => setRotateState('idle')

  const onConfirmRotate = async () => {
    setRotateState('rotating')
    const result = await rotateInboundSecretRequest(integration.id)
    if (!result.ok) {
      setRotateError(t(settingsErrorMessageKey(result.error)))
      setRotateState('idle')
      return
    }
    setRevealedSecret(result.webhookSecret)
    setSecretLast4(result.webhookSecret.slice(-4))
    setRotateState('revealed')
  }

  const onDismissReveal = () => {
    setRotateState('idle')
    setRevealedSecret(null)
  }

  return (
    <InboundCredentialsView
      webhookUrl={webhookUrl}
      secretLast4={secretLast4}
      isAdmin={isAdmin}
      rotateState={rotateState}
      revealedSecret={revealedSecret}
      rotateError={rotateError}
      copiedField={copiedField}
      onCopy={onCopy}
      onRequestRotate={onRequestRotate}
      onCancelRotate={onCancelRotate}
      onConfirmRotate={onConfirmRotate}
      onDismissReveal={onDismissReveal}
    />
  )
}
