'use client'

import { Suspense, useCallback, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { StepBatchMeta } from '@/components/dashboard/import-wizard/step-batch-meta'
import { StepUploadCsv } from '@/components/dashboard/import-wizard/step-upload-csv'
import {
  StepGradePreview,
  type PreviewRow,
} from '@/components/dashboard/import-wizard/step-grade-preview'
import { StepConfirm } from '@/components/dashboard/import-wizard/step-confirm'
import {
  useImportBatch,
  type ImportContactsBatchInput,
  type ImportContactsBatchResult,
} from '@/hooks/use-import-batch'
import type { ParsedRow } from '@/components/dashboard/import-wizard/parse-csv'
import type {
  BatchMetaInput,
  ConsentChannel,
} from '@/components/dashboard/import-wizard/step-batch-meta-helpers'
import { todayIso, isStepKey, type StepKey } from './wizard-helpers'
import { WizardStepper } from './wizard-stepper'

const EMPTY_META: BatchMetaInput = {
  source: '',
  dateRangeStart: '',
  dateRangeEnd: '',
  consentTextShown: '',
  consentChannel: 'whatsapp',
  proofFilePresent: false,
  tagIds: [],
}

// useSearchParams() must sit under a Suspense boundary or Next fails the
// whole build at prerender time (missing-suspense-with-csr-bailout).
export default function ImportWizardPage() {
  return (
    <Suspense fallback={null}>
      <ImportWizard />
    </Suspense>
  )
}

function ImportWizard() {
  const t = useTranslations('importWizard')
  const router = useRouter()
  const params = useSearchParams()
  const stepParam = params.get('step')
  const step: StepKey = isStepKey(stepParam) ? stepParam : 'meta'

  const [meta, setMeta] = useState<BatchMetaInput>(EMPTY_META)
  const [proofPath, setProofPath] = useState<string | null>(null)
  const [proofSignedUrl, setProofSignedUrl] = useState<string | null>(null)
  const [csvRows, setCsvRows] = useState<ParsedRow[]>([])
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([])
  const [previewBreakdown, setPreviewBreakdown] = useState({ strong: 0, medium: 0, weak: 0, none: 0 })
  const [previewRejected, setPreviewRejected] = useState<ImportContactsBatchResult['rejected']>([])
  const [merge, setMerge] = useState(false)
  const [previewPage, setPreviewPage] = useState(1)
  const [committed, setCommitted] = useState<ImportContactsBatchResult | null>(null)
  const today = useMemo(() => todayIso(), [])
  const { previewBatch, commitBatch, isLoading, error } = useImportBatch()

  const goto = useCallback(
    (next: StepKey) => router.replace(`?step=${next}`),
    [router]
  )

  const handleProofChange = useCallback((path: string | null, signedUrl: string | null) => {
    setProofPath(path)
    setProofSignedUrl(signedUrl)
    setMeta((m) => ({ ...m, proofFilePresent: path !== null }))
  }, [])

  const buildBatchInput = useCallback((): ImportContactsBatchInput => ({
    metadata: {
      source: meta.source,
      dateRangeStart: meta.dateRangeStart,
      dateRangeEnd: meta.dateRangeEnd,
      consentTextShown: meta.consentTextShown,
      consentChannel: meta.consentChannel as ConsentChannel,
      proofUrl: proofPath,
    },
    rows: csvRows,
    mergeExistingMembers: merge,
    tags: meta.tagIds,
  }), [meta, proofPath, csvRows, merge])

  async function runPreviewAndAdvance() {
    const res = await previewBatch(buildBatchInput())
    if (!res) return
    setPreviewBreakdown(res.gradeBreakdown)
    setPreviewRejected(res.rejected ?? [])
    setPreviewRows(res.rows)
    goto('grade')
  }

  async function runCommit() {
    const res = await commitBatch(buildBatchInput())
    if (res) setCommitted(res)
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-foreground">{t('heading')}</h1>
      <WizardStepper current={step} />

      {step === 'meta' && (
        <StepBatchMeta
          value={meta}
          proofPath={proofPath}
          proofSignedUrl={proofSignedUrl}
          today={today}
          onChange={setMeta}
          onProofChange={handleProofChange}
          onNext={() => goto('csv')}
        />
      )}

      {step === 'csv' && (
        <StepUploadCsv
          rows={csvRows}
          onParsed={setCsvRows}
          onBack={() => goto('meta')}
          onNext={runPreviewAndAdvance}
        />
      )}

      {step === 'grade' && (
        <StepGradePreview
          rows={previewRows}
          rejected={previewRejected}
          gradeBreakdown={previewBreakdown}
          mergeExistingMembers={merge}
          onMergeChange={setMerge}
          page={previewPage}
          onPageChange={setPreviewPage}
          onBack={() => goto('csv')}
          onNext={() => goto('confirm')}
        />
      )}

      {step === 'confirm' && (
        <StepConfirm
          isCommitting={isLoading}
          result={committed}
          error={error}
          onCommit={runCommit}
          onBack={() => goto('grade')}
          onDone={() => router.push('/dashboard/members')}
        />
      )}
    </div>
  )
}
