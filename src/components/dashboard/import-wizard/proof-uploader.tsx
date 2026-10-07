'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Upload, X } from 'lucide-react'
import {
  validateProofFile,
  PROOF_MAX_SIZE,
} from './proof-uploader-helpers'
import { useImportBatch } from '@/hooks/use-import-batch'

interface Props {
  storagePath: string | null
  signedUrl?: string | null
  onUploaded: (result: { storagePath: string; signedUrl: string }) => void
  onCleared: () => void
}

const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf'

export function ProofUploader({ storagePath, signedUrl, onUploaded, onCleared }: Props) {
  const t = useTranslations('importWizard')
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const { uploadProof, isLoading } = useImportBatch()

  async function handleFile(file: File) {
    const v = validateProofFile({ type: file.type, size: file.size })
    if (v) {
      setError(v.kind === 'tooLarge' ? t('proof.tooLarge') : t('proof.wrongType'))
      return
    }
    setError(null)
    const res = await uploadProof(file)
    if (res) onUploaded(res)
    if (inputRef.current) inputRef.current.value = ''
  }

  if (storagePath) {
    return (
      <div className="flex items-center gap-3" data-section="proof-current">
        {signedUrl && (
          <a
            href={signedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs underline text-foreground"
          >
            {t('proof.viewExisting')}
          </a>
        )}
        <button
          type="button"
          data-action="remove-proof"
          onClick={onCleared}
          className="inline-flex items-center gap-1 text-xs text-destructive"
        >
          <X className="size-3.5" /> {t('proof.remove')}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-1" data-section="proof-empty">
      <button
        type="button"
        data-action="pick-proof"
        onClick={() => inputRef.current?.click()}
        disabled={isLoading}
        className="inline-flex items-center gap-2 rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-60"
      >
        <Upload className="size-4" />
        {isLoading ? t('proof.uploading') : t('proof.pick')}
      </button>
      <p className="text-[11px] text-muted-foreground">
        {t('proof.hint', { maxMb: PROOF_MAX_SIZE / 1024 / 1024 })}
      </p>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handleFile(f)
        }}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
