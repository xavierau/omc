'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Upload, X } from 'lucide-react'
import { useTenant } from '@/components/providers/tenant-provider'
import {
  validateImageFile,
  buildCampaignImagePath,
  type Lang,
} from './campaign-image-uploader-helpers'

interface Props {
  lang: Lang
  campaignId: string | null
  draftNonce: string
  currentUrl: string
  onUploaded: (url: string) => void
  onRemoved: () => void
}

/**
 * Per-language image uploader for welcome campaigns (ONBOARD-010).
 * Rendered only when `campaign.type === 'welcome'` in the parent form.
 * Uploads to the `campaign-images` bucket under `{restaurantId}/{campaignId}/{lang}.ext`.
 * Removing just nulls the URL on the campaign row; orphan blob cleanup is
 * deferred (phase-1 accepts the storage cost).
 */
export function CampaignImageUploader({
  lang,
  campaignId,
  draftNonce,
  currentUrl,
  onUploaded,
  onRemoved,
}: Props) {
  const t = useTranslations('campaigns')
  const { restaurantId } = useTenant()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function upload(file: File) {
    if (!restaurantId) return
    const err = validateImageFile({ size: file.size, type: file.type })
    if (err) {
      setError(err.kind === 'tooLarge' ? t('imageTooLarge') : t('imageFormatHint'))
      return
    }
    setError(null)
    setUploading(true)
    try {
      const path = buildCampaignImagePath({
        restaurantId,
        campaignId,
        draftNonce,
        lang,
        mime: file.type,
      })
      const formData = new FormData()
      formData.append('file', file)
      formData.append('path', path)
      const res = await fetch('/api/dashboard/upload?bucket=campaign-images', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Upload failed')
      onUploaded(data.url)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('imageUploadError'))
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) void upload(file)
  }

  return (
    <div className="mt-3">
      <label className="text-sm font-medium text-foreground mb-1 block">
        {t('imageUploadLabel')}
      </label>
      <p className="text-xs text-muted-foreground mb-2">{t('imageUploadHelper')}</p>
      {currentUrl ? (
        <div className="relative inline-block">
          <Image
            src={currentUrl}
            alt=""
            width={96}
            height={96}
            className="h-24 w-24 rounded-lg object-cover border"
            unoptimized
          />
          <button
            type="button"
            onClick={onRemoved}
            aria-label={t('imageRemove')}
            className="absolute -top-2 -right-2 rounded-full bg-destructive text-destructive-foreground p-0.5"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : (
        <div
          onClick={() => inputRef.current?.click()}
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          className="flex flex-col items-center justify-center gap-1 border-2 border-dashed border-input rounded-lg p-4 cursor-pointer hover:bg-muted"
        >
          <Upload className="size-5 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            {uploading ? t('imageUploading') : t('imageDragDropHint')}
          </p>
          <p className="text-[10px] text-muted-foreground">{t('imageFormatHint')}</p>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void upload(f)
        }}
        className="hidden"
      />
      {/*
        Inline <p className="text-destructive"> is the canonical form-scoped
        error pattern in this app (see welcome-setup-save-row.tsx,
        campaign-form-dialog.tsx). There is no toast library wired up yet,
        so keep the inline surface consistent rather than introducing a
        one-off pattern here.
      */}
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  )
}
