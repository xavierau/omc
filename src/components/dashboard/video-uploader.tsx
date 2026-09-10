'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Upload, X } from 'lucide-react'
import { VIDEO_ACCEPT, videoFileError, readUploadResponse } from './video-uploader-helpers'

interface VideoUploaderProps {
  bucket: string
  currentUrl: string
  onUploaded: (url: string) => void
  onRemoved?: () => void
  className?: string
}

export function VideoUploader({ bucket, currentUrl, onUploaded, onRemoved, className }: VideoUploaderProps) {
  const t = useTranslations('common')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const preCheckError = videoFileError({ size: file.size, type: file.type })
    if (preCheckError) {
      setError(preCheckError)
      if (inputRef.current) inputRef.current.value = ''
      return
    }

    setError(null)
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`/api/dashboard/upload?bucket=${bucket}`, {
        method: 'POST',
        body: formData,
      })
      const data = await readUploadResponse(res)
      onUploaded(data.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function handleRemove() {
    onRemoved?.()
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className={className}>
      {currentUrl ? (
        <div className="relative inline-block">
          <video
            src={currentUrl}
            preload="metadata"
            muted
            controls
            className="h-20 w-20 rounded-lg object-cover border"
          />
          {onRemoved && (
            <button
              type="button"
              onClick={handleRemove}
              className="absolute -top-2 -right-2 rounded-full bg-destructive text-destructive-foreground p-0.5"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      ) : null}
      <div className="flex items-center gap-2 mt-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="size-4 mr-1.5" />
          {uploading ? t('loading') : currentUrl ? t('regenerate') : t('generate')}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={VIDEO_ACCEPT}
          onChange={handleFileChange}
          className="hidden"
        />
      </div>
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  )
}
