/**
 * Wire types for the contact import wizard. Canonical contract from
 * Stream A (commit) + Stream C (preview); mirrored on the server route
 * handlers under /api/dashboard/imports/*.
 */

import type { ConsentChannel } from '@/components/dashboard/import-wizard/step-batch-meta-helpers'
import type { ConsentGrade } from '@/components/dashboard/import-wizard/grade-badge'
import type {
  PreviewContactsBatchResult,
  PreviewRow,
} from '@/application/preview-contacts-batch'

export type { ConsentGrade }
export type { PreviewContactsBatchResult, PreviewRow }

export interface ImportBatchMetadata {
  source: string
  dateRangeStart: string
  dateRangeEnd: string
  consentTextShown: string
  consentChannel: ConsentChannel
  proofUrl: string | null
}

export interface ImportContactsBatchRow {
  phoneE164: string
  name?: string | null
  preferredLanguage?: 'en' | 'zh_hk' | null
}

export interface ImportContactsBatchInput {
  restaurantId?: string
  createdBy?: string | null
  metadata: ImportBatchMetadata
  rows: ImportContactsBatchRow[]
  mergeExistingMembers: boolean
  tags?: string[]
}

export type ImportRejectReason =
  | 'phone_already_member'
  | 'duplicate_phone_in_batch'
  | 'duplicate_active'
  | 'invalid_phone'

export interface ImportRowReject {
  phoneE164: string
  reason: ImportRejectReason
  message?: string
}

export interface GradeBreakdown {
  strong: number
  medium: number
  weak: number
  none: number
}

export interface ImportContactsBatchResult {
  importBatchId: string
  inserted: number
  membersCreated: number
  rejected: ImportRowReject[]
  gradeBreakdown: GradeBreakdown
}

export interface ImportBatchSummary {
  id: string
  source: string
  createdAt: string
  rowCount: number
  gradeBreakdown: GradeBreakdown
}

export interface ProofUploadResult {
  storagePath: string
  signedUrl: string
}
