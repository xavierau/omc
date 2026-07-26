'use client'

/**
 * REPLY-008: the contact form itself, plus its success modal.
 *
 * Labels and topics come from the tenant's own `contact_config` — the same
 * values the WhatsApp Flow binds — so a tenant who customised their Flow copy
 * sees that copy here too.
 *
 * The customer's phone number is deliberately NOT an input and is never
 * posted: the server derives it from the one-off token, which is the only
 * authenticated fact about a public web submission. It is shown read-only so
 * the customer can see which number the reply will go to.
 */
import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { ContactLabels } from '@/domain/services/contact-config'
import { CLIENT_NAME_MAX_LEN } from '@/domain/services/contact-web-form'

type Phase = 'form' | 'submitting' | 'done' | 'dismissed'

export function ContactWebForm({
  slug,
  token,
  tenantName,
  logoUrl,
  labels,
  topics,
  retryUrl,
  returnUrl,
}: {
  slug: string
  token: string
  tenantName: string
  logoUrl: string | null
  labels: ContactLabels
  topics: string[]
  retryUrl: string | null
  returnUrl: string | null
}) {
  const [phase, setPhase] = useState<Phase>('form')
  const [clientName, setClientName] = useState('')
  const [topic, setTopic] = useState(topics[0] ?? '')
  const [error, setError] = useState('')
  // A token rejected at submit time (expired between load and submit, or
  // already consumed) is terminal, not retryable — the form is replaced by the
  // recovery prompt rather than left inviting another doomed attempt.
  const [unusable, setUnusable] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!clientName.trim() || !topic) {
      setError('請填寫所有欄位。')
      return
    }

    setPhase('submitting')
    try {
      const res = await fetch(`/api/contact/${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, clientName: clientName.trim(), topic }),
      })

      if (res.ok) {
        setPhase('done')
        return
      }

      // 410 is the server's "this token is spent or expired" — the one case
      // where retrying the same form can never work.
      if (res.status === 410) {
        setUnusable(true)
        return
      }
      setPhase('form')
      setError('提交失敗,請稍後再試。')
    } catch {
      setPhase('form')
      setError('提交失敗,請檢查網絡連線後再試。')
    }
  }

  if (unusable) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>連結已失效</CardTitle>
          <CardDescription>
            此表格連結已過期或已提交。請重新索取新的表格連結。
          </CardDescription>
        </CardHeader>
        {retryUrl ? (
          <CardContent>
            <a
              href={retryUrl}
              className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              重新索取表格連結
            </a>
          </CardContent>
        ) : null}
      </Card>
    )
  }

  if (phase === 'done' || phase === 'dismissed') {
    return (
      <SuccessState
        phase={phase}
        returnUrl={returnUrl}
        onDismiss={() => {
          setPhase('dismissed')
          // Best-effort only: window.close() is permitted solely for windows
          // opened by script, so it is a no-op in WhatsApp's in-app browser and
          // in an ordinary tab. The return-to-WhatsApp link below is what
          // actually gets the customer back to the conversation.
          window.close()
        }}
      />
    )
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="items-center text-center">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={tenantName} className="mb-3 h-16 w-16 rounded-full object-cover" />
        ) : null}
        <CardTitle>{labels.title}</CardTitle>
        <CardDescription>{tenantName}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {labels.nameLabel}
            <Input
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              maxLength={CLIENT_NAME_MAX_LEN}
              required
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {labels.topicLabel}
            <select
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              required
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {topics.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <Button type="submit" disabled={phase === 'submitting'}>
            {phase === 'submitting' ? '提交中…' : labels.submitLabel}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

/**
 * Success modal, then a terminal panel once dismissed.
 *
 * There is no path back to the form from here: by this point the server has
 * already burnt the token, so re-showing an editable form would only produce a
 * guaranteed failure.
 */
function SuccessState({
  phase,
  returnUrl,
  onDismiss,
}: {
  phase: 'done' | 'dismissed'
  returnUrl: string | null
  onDismiss: () => void
}) {
  return (
    <>
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>已成功提交</CardTitle>
          <CardDescription>我們的團隊會盡快透過 WhatsApp 與您聯絡。</CardDescription>
        </CardHeader>
        {returnUrl ? (
          <CardContent>
            <a
              href={returnUrl}
              className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              返回 WhatsApp
            </a>
          </CardContent>
        ) : null}
      </Card>

      {phase === 'done' ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="contact-success-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="w-full max-w-sm rounded-lg bg-background p-6 text-center shadow-lg">
            <h2 id="contact-success-title" className="text-lg font-semibold">
              已成功提交
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              多謝您的查詢,我們會盡快回覆您。
            </p>
            <Button className="mt-5 w-full" onClick={onDismiss}>
              關閉
            </Button>
          </div>
        </div>
      ) : null}
    </>
  )
}
