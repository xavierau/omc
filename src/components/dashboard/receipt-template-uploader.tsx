'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useTenant } from '@/hooks/use-tenant'

const MIN_IMAGES = 3
const MAX_IMAGES = 5

export function ReceiptTemplateUploader({ onSuccess }: {
  onSuccess: () => void
}) {
  const t = useTranslations('receiptTemplate')
  const { restaurantId } = useTenant()
  const [files, setFiles] = useState<File[]>([])
  const [status, setStatus] = useState<'idle' | 'uploading' | 'building' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []).slice(0, MAX_IMAGES)
    setFiles(selected)
    setStatus('idle')
    setResult(null)
  }

  async function handleBuild() {
    if (files.length < MIN_IMAGES || files.length > MAX_IMAGES) return
    try {
      setStatus('uploading')
      const urls = await uploadImages(files)
      setStatus('building')
      const res = await fetch('/api/dashboard/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurantId, imageUrls: urls }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Build failed')
      const data = await res.json()
      setStatus('done')
      setResult(t('templateCreated', { count: data.regionCount }))
      onSuccess()
    } catch (err) {
      setStatus('error')
      setResult(err instanceof Error ? err.message : t('somethingWentWrong'))
    }
  }

  function handleReset() {
    setFiles([])
    setStatus('idle')
    setResult(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const isBuilding = status === 'uploading' || status === 'building'
  const canBuild = files.length >= MIN_IMAGES && files.length <= MAX_IMAGES && !isBuilding

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('uploadTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <FileInput inputRef={inputRef} onChange={handleFileChange} disabled={isBuilding} />
        <Thumbnails files={files} />
        <FileCount count={files.length} t={t} />
        <StatusMessage status={status} result={result} />
        <div className="flex gap-2">
          <Button onClick={handleBuild} disabled={!canBuild}>
            {isBuilding ? (status === 'uploading' ? t('uploading') : t('building')) : t('buildTemplate')}
          </Button>
          {files.length > 0 && <Button variant="outline" onClick={handleReset}>{t('clear')}</Button>}
        </div>
      </CardContent>
    </Card>
  )
}

function FileInput({ inputRef, onChange, disabled }: {
  inputRef: React.RefObject<HTMLInputElement | null>
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  disabled: boolean
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept="image/jpeg,image/png"
      multiple
      onChange={onChange}
      disabled={disabled}
      className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/80"
    />
  )
}

function Thumbnails({ files }: { files: File[] }) {
  if (files.length === 0) return null
  return (
    <div className="flex gap-2 flex-wrap">
      {files.map((f, i) => (
        <Image
          key={i}
          src={URL.createObjectURL(f)}
          alt={f.name}
          width={64}
          height={64}
          className="w-16 h-16 object-cover rounded-md border"
          unoptimized
        />
      ))}
    </div>
  )
}

function FileCount({ count, t }: { count: number; t: ReturnType<typeof useTranslations> }) {
  if (count === 0) return <p className="text-sm text-muted-foreground">{t('selectImages', { min: MIN_IMAGES, max: MAX_IMAGES })}</p>
  const valid = count >= MIN_IMAGES && count <= MAX_IMAGES
  return (
    <p className={`text-sm ${valid ? 'text-muted-foreground' : 'text-destructive'}`}>
      {t('filesSelected', { count })} {!valid && t('needRange', { min: MIN_IMAGES, max: MAX_IMAGES })}
    </p>
  )
}

function StatusMessage({ status, result }: { status: string; result: string | null }) {
  if (status === 'done') return <p className="text-sm text-green-600 font-medium">{result}</p>
  if (status === 'error') return <p className="text-sm text-destructive">{result}</p>
  return null
}

async function uploadImages(files: File[]): Promise<string[]> {
  const formData = new FormData()
  files.forEach(f => formData.append('images', f))
  const res = await fetch('/api/dashboard/templates/upload', { method: 'POST', body: formData })
  if (!res.ok) throw new Error('Image upload failed')
  const data = await res.json()
  return data.urls
}
