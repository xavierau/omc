/**
 * REPLY-008: terminal state for a link that cannot be used — expired, already
 * submitted, or unrecognised.
 *
 * Server component (no interactivity beyond links). The recovery path is the
 * point of this screen: rather than a dead end, it offers a deep link that
 * sends a CONTACT keyword to the tenant's WhatsApp, which re-enters
 * `handleContact` and mints a fresh 30-minute link — and re-arms the 24-hour
 * service window at the same time, so the next submission's ack is deliverable.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { ContactTokenState } from '@/domain/services/contact-web-form'

const COPY: Record<Exclude<ContactTokenState, 'valid'>, { title: string; description: string }> = {
  expired: {
    title: '連結已過期',
    description: '為保障您的資料,此連結只在 30 分鐘內有效。請重新索取新的表格連結。',
  },
  // Distinct from `expired` on purpose: "we already have your enquiry" is
  // reassuring, while "expired" would make a customer think it failed and
  // submit again.
  consumed: {
    title: '已收到您的查詢',
    description: '此表格已經提交,我們的團隊會盡快與您聯絡。如需再次查詢,請索取新的表格連結。',
  },
  unknown: {
    title: '連結無效',
    description: '此連結無法使用。請重新索取新的表格連結。',
  },
}

export function ContactFormUnavailable({
  state,
  tenantName,
  logoUrl,
  retryUrl,
}: {
  state: Exclude<ContactTokenState, 'valid'>
  tenantName: string
  logoUrl: string | null
  retryUrl: string | null
}) {
  const copy = COPY[state]

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="items-center text-center">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={tenantName} className="mb-3 h-16 w-16 rounded-full object-cover" />
        ) : null}
        <CardTitle>{copy.title}</CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {retryUrl ? (
          <a
            href={retryUrl}
            className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            重新索取表格連結
          </a>
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            請返回 WhatsApp 對話,輸入「聯絡我們」重新索取表格。
          </p>
        )}
      </CardContent>
    </Card>
  )
}
