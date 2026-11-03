'use client'

// WAQ-011-DETAIL: the template as a WhatsApp message bubble, so the admin
// judges what members would actually receive. Everything renders as text;
// media URLs pass through safeHttpsUrl (https only) in the model.

import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { ExternalLink, Phone, Copy, Reply } from 'lucide-react'
import type { TemplateComponent, TemplateButtonType } from '@/domain/entities/whatsapp-template'
import {
  buildTemplatePreview,
  type PreviewHeader,
  type PreviewButton,
} from './template-review-preview-model'

type T = ReturnType<typeof useTranslations>

export function TemplateReviewPreview({ components }: { components: TemplateComponent[] }) {
  const t = useTranslations('adminTemplateReviews')
  const model = buildTemplatePreview(components)
  return (
    <div data-testid="template-review-preview" className="rounded-lg bg-muted p-4">
      <div className="max-w-[360px] overflow-hidden rounded-lg bg-background shadow-sm ring-1 ring-border">
        <HeaderView header={model.header} t={t} />
        <div className="space-y-1.5 px-3 py-2">
          {model.body && <p className="whitespace-pre-wrap break-words leading-relaxed">{model.body}</p>}
          {model.footer && <p className="text-xs text-muted-foreground">{model.footer}</p>}
        </div>
        {model.buttons.length > 0 && <ButtonList buttons={model.buttons} t={t} />}
      </div>
    </div>
  )
}

function HeaderView({ header, t }: { header: PreviewHeader | null; t: T }) {
  if (!header) return null
  switch (header.kind) {
    case 'text':
      return <p className="px-3 pt-2 font-semibold break-words">{header.text}</p>
    case 'image':
      return (
        <Image
          src={header.url}
          alt=""
          width={360}
          height={200}
          className="h-auto max-h-[320px] w-full object-cover"
          unoptimized
        />
      )
    case 'video':
      return <video src={header.url} controls preload="metadata" className="w-full bg-muted" />
    case 'document':
      return <MutedHeader label={t('previewDocument')} href={header.url} />
    case 'media-unavailable':
      return <MutedHeader label={t('previewMediaUnavailable')} href={null} />
  }
}

function MutedHeader({ label, href }: { label: string; href: string | null }) {
  return (
    <div className="border-b bg-muted/60 px-3 py-6 text-center text-xs text-muted-foreground">
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
          {label}
        </a>
      ) : label}
    </div>
  )
}

const BUTTON_META: Record<TemplateButtonType, { icon: typeof Reply; labelKey: string }> = {
  URL: { icon: ExternalLink, labelKey: 'previewButtonUrl' },
  PHONE_NUMBER: { icon: Phone, labelKey: 'previewButtonPhone' },
  COPY_CODE: { icon: Copy, labelKey: 'previewButtonCopyCode' },
  QUICK_REPLY: { icon: Reply, labelKey: 'previewButtonQuickReply' },
}

function ButtonList({ buttons, t }: { buttons: PreviewButton[]; t: T }) {
  return (
    <ul className="divide-y border-t">
      {buttons.map((b, i) => {
        const meta = BUTTON_META[b.type] ?? BUTTON_META.QUICK_REPLY
        const Icon = meta.icon
        return (
          <li key={`${b.type}-${i}`} className="px-3 py-2">
            <div className="flex items-center justify-center gap-1.5 font-medium text-primary">
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className="break-words">{b.text}</span>
            </div>
            <p className="mt-0.5 text-center text-xs text-muted-foreground break-all">
              {t(meta.labelKey)}{b.target ? ` · ${b.target}` : ''}
            </p>
          </li>
        )
      })}
    </ul>
  )
}
